import { ListWorkflowVersionsCommandInput, WorkflowStatus } from '@aws-sdk/client-omics';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  MissingAWSHealthOmicsAccessError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { OmicsService } from '@BE/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { resolveSharedWorkflowOwnerId } from '@BE/utils/omics-shared-workflow-utils';
import { AwsHealthOmicsQueryParameters, getAwsHealthOmicsApiQueryParameters } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const omicsService = new OmicsService();

/**
 * This GET /aws-healthomics/workflow/list-workflow-versions?laboratoryId={LaboratoryId}&workflowId={WorkflowId}
 * API queries AWS HealthOmics for workflow versions for a private or shared workflow.
 * Shared workflows resolve workflowOwnerId via ListShares when not supplied.
 *
 * Required query parameters:
 *  - laboratoryId
 *  - workflowId
 *
 * Optional: maxResults, nextToken (startingToken), workflowOwnerId
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const workflowId: string = event.queryStringParameters?.workflowId || '';
    if (workflowId === '') throw new RequiredIdNotFoundError('workflowId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new MissingAWSHealthOmicsAccessError();
    }

    const queryParameters: AwsHealthOmicsQueryParameters = getAwsHealthOmicsApiQueryParameters(event);
    const workflowOwnerId =
      event.queryStringParameters?.workflowOwnerId ||
      (await resolveSharedWorkflowOwnerId(omicsService, workflowId));

    const response = await omicsService.listWorkflowVersions(<ListWorkflowVersionsCommandInput>{
      workflowId,
      type: 'PRIVATE',
      ...(workflowOwnerId ? { workflowOwnerId } : {}),
      ...queryParameters,
    });

    const items = (response.items ?? []).filter((v) => v.status === undefined || v.status === WorkflowStatus.ACTIVE);

    return buildResponse(200, JSON.stringify({ ...response, items }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
