import { ListRunsCommandInput, RunStatus, RunListItem } from '@aws-sdk/client-omics';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
  MissingAWSHealthOmicsAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { AwsHealthOmicsQueryParameters, getAwsHealthOmicsApiQueryParameters } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();

/**
 * This GET /aws-healthomics/run/list-runs?laboratoryId={LaboratoryId}
 * API queries the same region's AWS HealthOmics service to retrieve a list of
 * Runs, and it expects:
 *  - Required Query Parameter:
 *    - 'laboratoryId': to retrieve the Laboratory to verify access to AWS HealthOmics
 *  - Optional Query Parameters:
 *    - 'maxResults': pagination number of results
 *    - 'nextToken': pagination results offset index
 *    - 'name': string to search by the Workflow name attribute
 *    - 'status': string to search by Status of Workflow Run
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get required query parameter
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

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

    // Requires AWS Health Omics access
    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new MissingAWSHealthOmicsAccessError();
    }

    const queryParameters: AwsHealthOmicsQueryParameters = getAwsHealthOmicsApiQueryParameters(event);

    // DDB-backed listing from the canonical laboratory-run table to avoid relying on HealthOmics ListRuns IAM scoping.
    // We return an Omics-compatible ListRunsResponse shape.
    const runs = await laboratoryRunService.queryByLaboratoryId(laboratory.LaboratoryId);

    const statusFilter = validateRunStatusQueryParameter(queryParameters.status);
    const nameFilter = (queryParameters.name ?? '').toLowerCase().trim();

    const filtered = runs.filter((r) => {
      if (r.Platform !== 'AWS HealthOmics') return false;
      if (statusFilter && r.Status?.toUpperCase() !== statusFilter.toUpperCase()) return false;
      if (nameFilter && !r.RunName?.toLowerCase().includes(nameFilter)) return false;
      return true;
    });

    const maxResults = queryParameters.maxResults ? Number(queryParameters.maxResults) : undefined;
    const offset = queryParameters.startingToken
      ? Number(Buffer.from(queryParameters.startingToken, 'base64').toString('utf8'))
      : 0;
    const pageSize = maxResults && Number.isFinite(maxResults) ? Math.max(1, Math.min(200, maxResults)) : 50;

    const page = filtered.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const nextToken =
      nextOffset < filtered.length ? Buffer.from(String(nextOffset), 'utf8').toString('base64') : undefined;

    const items: RunListItem[] = page.map((r) => ({
      id: r.ExternalRunId ?? '',
      arn:
        r.ExternalRunId && process.env.REGION && process.env.ACCOUNT_ID
          ? `arn:aws:omics:${process.env.REGION}:${process.env.ACCOUNT_ID}:run/${r.ExternalRunId}`
          : undefined,
      name: r.RunName,
      status: r.Status as any,
      workflowId: r.WorkflowName,
      creationTime: r.CreatedAt ? new Date(r.CreatedAt) : undefined,
    }));

    const response = (<any>{
      items,
      ...(nextToken ? { nextToken } : {}),
    }) satisfies Partial<ListRunsCommandInput>;

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Helper function to validate status query parameter and return the corresponding RunStatus filter.
 */
function validateRunStatusQueryParameter(status: string | undefined): RunStatus | undefined {
  if (!status) {
    return undefined;
  }

  switch (status.toUpperCase()) {
    case 'CANCELLED':
      return RunStatus.CANCELLED;
    case 'COMPLETED':
      return RunStatus.COMPLETED;
    case 'DELETED':
      return RunStatus.DELETED;
    case 'FAILED':
      return RunStatus.FAILED;
    case 'PENDING':
      return RunStatus.PENDING;
    case 'RUNNING':
      return RunStatus.RUNNING;
    case 'STARTING':
      return RunStatus.STARTING;
    case 'STOPPING':
      return RunStatus.STOPPING;
    default:
      return undefined;
  }
}
