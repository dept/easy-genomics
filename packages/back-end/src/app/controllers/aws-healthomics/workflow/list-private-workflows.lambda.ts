import { ListWorkflowsCommandInput } from '@aws-sdk/client-omics/dist-types/commands/ListWorkflowsCommand';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
  MissingAWSHealthOmicsAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { OmicsService } from '@BE/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { isWorkflowAccessAllowed } from '@BE/utils/laboratory-workflow-access-utils';
import { AwsHealthOmicsQueryParameters, getAwsHealthOmicsApiQueryParameters } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const omicsService = new OmicsService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * This GET /aws-healthomics/workflow/list-private-workflows?laboratoryId={LaboratoryId}
 * API queries the same region's AWS HealthOmics service to retrieve a list of
 * Private Workflows, and it expects:
 *  - Required Query Parameter:
 *    - 'laboratoryId': to retrieve the Laboratory to verify access to AWS HealthOmics
 *  - Optional Query Parameters:
 *    - 'maxResults': pagination number of results
 *    - 'nextToken': pagination results offset index
 *    - 'name': string to search by the Workflow name attribute
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
    const response = await omicsService.listWorkflows(<ListWorkflowsCommandInput>{
      type: 'PRIVATE',
      ...queryParameters,
      status: undefined, // Explicitly exclude status filter for Workflows
    });

    const accessRows = await laboratoryWorkflowAccessService.listByLaboratoryId(laboratoryId);
    const items = (response.items ?? []).filter(
      (w) => w.id != null && isWorkflowAccessAllowed(laboratory, accessRows, 'HEALTH_OMICS', String(w.id)),
    );

    return buildResponse(200, JSON.stringify({ ...response, items }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
