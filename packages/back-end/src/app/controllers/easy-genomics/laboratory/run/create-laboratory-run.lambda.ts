import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  AddLaboratoryRun,
  AddLaboratoryRunSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SnsService } from '@BE/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const dataTaggingService = new LaboratoryDataTaggingService();
const snsService = new SnsService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId = event.requestContext.authorizer.claims['cognito:username'];
    const currentUserEmail = event.requestContext.authorizer.claims.email;
    // Post Request Body
    const request: AddLaboratoryRun = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!AddLaboratoryRunSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Validate Laboratory exists before creating Laboratory Run
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    if (!laboratory) {
      throw new LaboratoryNotFoundError();
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

    const createdAt = new Date();
    const isTerminalAtCreate = isTerminalLaboratoryRunStatus(request.Status);
    const retentionMonths = getRetentionMonthsOrDefault(laboratory.RunRetentionMonths);
    const laboratorioRunExpiresAt: number | undefined =
      isTerminalAtCreate && shouldExpireWithRetentionMonths(retentionMonths)
        ? calculateExpiresAtEpochSeconds(createdAt, retentionMonths)
        : undefined;

    const laboratoryRun: LaboratoryRun = await laboratoryRunService.add(<LaboratoryRun>{
      LaboratoryId: laboratory.LaboratoryId,
      RunId: request.RunId,
      UserId: currentUserId,
      OrganizationId: laboratory.OrganizationId,
      RunName: request.RunName,
      Platform: request.Platform,
      PlatformApiBaseUrl: request.PlatformApiBaseUrl,
      Status: request.Status,
      Owner: currentUserEmail,
      WorkflowName: request.WorkflowName,
      WorkflowVersionName: request.WorkflowVersionName,
      WorkflowExternalId: request.WorkflowExternalId,
      InputFileKeys: request.InputFileKeys,
      ExternalRunId: request.ExternalRunId,
      InputS3Url: request.InputS3Url,
      OutputS3Url: request.OutputS3Url,
      SampleSheetS3Url: request.SampleSheetS3Url,
      Settings: JSON.stringify(request.Settings || {}),
      CreatedAt: createdAt.toISOString(),
      CreatedBy: currentUserId,
      ...(isTerminalAtCreate ? { TerminalAt: createdAt.toISOString() } : {}),
      ...(laboratorioRunExpiresAt !== undefined ? { ExpiresAt: laboratorioRunExpiresAt } : {}),
    });

    // Best-effort: associate input files with a workflow tag so the data tagging page can
    // show "files used by workflow X". Failures here must NEVER block run creation.
    await associateInputsWithWorkflowTag({
      laboratory,
      userId: currentUserId,
      request,
    });

    if (laboratoryRun.ExternalRunId) {
      // Queue up run status checks
      const record: SnsProcessingEvent = {
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: laboratoryRun,
      };
      await snsService.publish({
        TopicArn: process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `update-laboratory-run-${laboratoryRun.RunId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }

    return buildResponse(200, JSON.stringify(laboratoryRun), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Best-effort hook that records the file -> workflow association in the laboratory data
 * tagging table when a run is launched. Skips silently when any of the required pieces
 * are missing (legacy runs, runs without explicit input keys, runs whose keys live outside
 * the lab bucket, etc.) and never throws — tagging failures must not break run creation.
 */
async function associateInputsWithWorkflowTag(args: {
  laboratory: Laboratory;
  userId: string;
  request: AddLaboratoryRun;
}): Promise<void> {
  const { laboratory, userId, request } = args;
  try {
    const inputKeys = (request.InputFileKeys || []).filter((k) => typeof k === 'string' && k.length > 0);
    if (!inputKeys.length) return;
    if (!request.WorkflowExternalId) return;
    if (!laboratory.S3Bucket) return;

    const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const labScopedKeys = inputKeys.filter((k) => k.startsWith(labPrefix));
    if (!labScopedKeys.length) return;

    const tag = await dataTaggingService.getOrCreateWorkflowTag(laboratory, userId, {
      platform: request.Platform,
      externalId: request.WorkflowExternalId,
      versionName: request.WorkflowVersionName,
      name: request.WorkflowName?.trim() || request.WorkflowExternalId,
    });

    await dataTaggingService.applyWorkflowToFiles(laboratory, userId, tag.TagId, laboratory.S3Bucket, labScopedKeys);
  } catch (err) {
    console.warn('Failed to associate input files with workflow tag (continuing):', err);
  }
}
