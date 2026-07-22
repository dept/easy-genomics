import { StartRunCommandInput } from '@aws-sdk/client-omics';
import { CreateRunRequestSchema } from '@easy-genomics/shared-lib/lib/app/schema/aws-healthomics/aws-healthomics-api';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateRunRequest } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { OmicsService } from '@BE/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasWorkflowAccess } from '@BE/utils/laboratory-workflow-access-utils';

const laboratoryService = new LaboratoryService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * Derives the S3 bucket to host the laboratory's HealthOmics run cache. Prefers the Laboratory's
 * configured `S3Bucket`, falling back to the bucket component of the run's output location.
 */
function resolveCacheBucket(laboratory: Laboratory, outdir?: string): string | undefined {
  if (laboratory.S3Bucket) return laboratory.S3Bucket;
  const match = outdir?.match(/^s3:\/\/([^/]+)\//);
  return match ? match[1] : undefined;
}

/**
 * Ensures the laboratory has an AWS HealthOmics run cache and returns its id.
 *
 * The cache is what makes retry/resume possible: when a run started with this cache fails, its
 * completed task outputs are saved (cacheBehavior CACHE_ON_FAILURE). A later run started with the
 * same cache resumes from the last completed task whenever the task fingerprint (inputs, params,
 * script, container) is unchanged, and recomputes only what actually changed. This means:
 *  - retrying with the same sample data (with or without parameter tweaks) reuses completed work;
 *  - changing the sample data invalidates the affected tasks, so it effectively runs fresh;
 *  - runs launched before caching existed have nothing cached, so they run fresh.
 *
 * One cache is provisioned per laboratory (lazily, on first run) and its id is persisted on the
 * Laboratory so all subsequent runs share it. This is best-effort: any failure here is logged and
 * results in `undefined`, so the run still launches normally (just without resume support).
 */
async function ensureLaboratoryRunCache(
  laboratory: Laboratory,
  omicsService: OmicsService,
  outdir: string | undefined,
  modifiedBy: string,
): Promise<string | undefined> {
  try {
    if (laboratory.HealthOmicsRunCacheId) return laboratory.HealthOmicsRunCacheId;

    const bucket = resolveCacheBucket(laboratory, outdir);
    if (!bucket) {
      console.warn(
        `[create-run-execution] No S3 bucket resolvable for LaboratoryId=${laboratory.LaboratoryId}; skipping run cache provisioning.`,
      );
      return undefined;
    }

    const created = await omicsService.createRunCache({
      cacheS3Location: `s3://${bucket}/run-cache/`,
      cacheBehavior: 'CACHE_ON_FAILURE',
      name: `${process.env.NAME_PREFIX}-${laboratory.LaboratoryId}-run-cache`,
      description: `Easy Genomics run cache for Laboratory ${laboratory.LaboratoryId}`,
      // Stable idempotency token keeps concurrent first-runs from creating duplicate caches.
      requestId: `${laboratory.LaboratoryId}-run-cache`,
      tags: {
        LaboratoryId: laboratory.LaboratoryId,
        OrganizationId: laboratory.OrganizationId,
        Application: 'easy-genomics',
      },
    });

    const cacheId: string | undefined = created.id;
    if (!cacheId) return undefined;

    // Persist on the Laboratory so every subsequent run reuses the same cache.
    await laboratoryService.update(
      { ...laboratory, HealthOmicsRunCacheId: cacheId, ModifiedAt: new Date().toISOString(), ModifiedBy: modifiedBy },
      laboratory,
    );

    return cacheId;
  } catch (error) {
    console.error(
      `[create-run-execution] Failed to provision run cache for LaboratoryId=${laboratory.LaboratoryId}:`,
      error,
    );
    return undefined; // Best-effort: never block a run because caching could not be set up.
  }
}

/**
 * This POST /aws-healthomics/run/create-run-execution?laboratoryId={LaboratoryId}
 * API issues the command to the same region's AWS HealthOmics service to create
 * a new Workflow Run, and it expects:
 *  - Required Query Parameter:
 *    - 'laboratoryId': to retrieve the Laboratory to verify access to AWS HealthOmics
 *  - JSON payload defining the input parameters for starting a Workflow Run
 *    - workflowId
 *    - requestId (transactionId)
 *    - name
 *    - parameters (JSON document defining the inputs for the Workflow including the sample-sheet)
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Post Request Body
    const request: CreateRunRequest = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!CreateRunRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    // Get required query parameter
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new UnauthorizedAccessError('Laboratory does not have AWS HealthOmics enabled');
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    await assertLaboratoryHasWorkflowAccess(
      laboratory,
      'HEALTH_OMICS',
      request.workflowId!,
      laboratoryWorkflowAccessService,
    );

    // User metadata is optional: IAM access control is enforced via LaboratoryId/OrganizationId tagging.
    // We still accept missing `sub/email` so run creation doesn't fail for users depending on claim mapping.
    const userId: string | undefined =
      event.requestContext.authorizer?.claims?.sub ?? event.requestContext.authorizer?.claims?.['cognito:username'];
    const userEmail: string | undefined = event.requestContext.authorizer?.claims?.email;
    // STS session naming and optional UserId session tag.
    const omicsUserId = userId ?? 'unknown-user';
    const omicsService = await createOmicsServiceForLab(
      laboratory.LaboratoryId,
      laboratory.OrganizationId,
      omicsUserId,
    );

    const parameters = JSON.parse(request.parameters!.toString());

    // Ensure the lab has a run cache so failed runs can be resumed on retry (best-effort).
    const cacheId: string | undefined = await ensureLaboratoryRunCache(
      laboratory,
      omicsService,
      parameters.outdir,
      omicsUserId,
    );

    const { workflowVersionName, ...startRunRequestWithoutVersion } = request;
    const response = await omicsService.startRun(<StartRunCommandInput>{
      ...startRunRequestWithoutVersion,
      ...(workflowVersionName ? { workflowVersionName } : {}),
      // Attaching the cache makes runs resume-capable: completed tasks from a prior failed run with
      // the same fingerprint are reused, and only changed/failed tasks (and their dependents) re-run.
      ...(cacheId ? { cacheId, cacheBehavior: 'CACHE_ON_FAILURE' } : {}),
      parameters: {
        ...parameters,
        outdir: '/mnt/workflow/pubdir', // AWS HealthOmics requires explicitly setting 'outdir' = '/mnt/workflow/pubdir' for internal output
      },
      outputUri: parameters.outdir, // AWS HealthOmics requires setting outputUri for copying 'outdir' output to the final destination
      workflowType: 'PRIVATE',
      roleArn: `arn:aws:iam::${process.env.ACCOUNT_ID}:role/${process.env.NAME_PREFIX}-easy-genomics-healthomics-workflow-run-role`,
      tags: {
        LaboratoryId: laboratory.LaboratoryId,
        OrganizationId: laboratory.OrganizationId,
        WorkflowId: request.workflowId,
        RunName: request.name,
        ...(userId && { UserId: userId }),
        ...(userEmail && { UserEmail: userEmail }),
        Application: 'easy-genomics',
        Platform: 'AWS HealthOmics',
      },
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
