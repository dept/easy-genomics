import { ListWorkflowsCommandInput } from '@aws-sdk/client-omics/dist-types/commands/ListWorkflowsCommand';
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
 * Retrieves every PRIVATE workflow across all pages so the workflow-access filter
 * is applied to the complete set. Fetching only a single page would hide any
 * granted workflow that happens to fall beyond the first page from every user,
 * even though it appears in the (fully paginated) admin workflow catalog.
 */
async function listAllPrivateWorkflows(name?: string) {
  const items: NonNullable<Awaited<ReturnType<OmicsService['listWorkflows']>>['items']> = [];
  let nextToken: string | undefined;
  do {
    const page = await omicsService.listWorkflows(<ListWorkflowsCommandInput>{
      type: 'PRIVATE',
      maxResults: 100,
      startingToken: nextToken,
      status: undefined, // Explicitly exclude status filter for Workflows
      ...(name ? { name } : {}),
    });
    if (page.items?.length) {
      items.push(...page.items);
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

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
    const allItems = await listAllPrivateWorkflows(queryParameters.name);

    const accessRows = await laboratoryWorkflowAccessService.listByLaboratoryId(laboratoryId);
    const items = allItems.filter(
      (w) => w.id != null && isWorkflowAccessAllowed(laboratory, accessRows, 'HEALTH_OMICS', w.id),
    );

    return buildResponse(200, JSON.stringify({ items }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
