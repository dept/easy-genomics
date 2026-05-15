import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryAccessTokenUnavailableError,
  LaboratoryNotFoundError,
  MissingNextFlowTowerAccessError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { DescribeWorkflowReportsResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/workflow-reports';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();

/**
 * This GET /nf-tower/workflow/list-workflow-reports/{:id}?laboratoryId={LaboratoryId}
 * API queries the NextFlow Tower GET /workflow/{:id}/reports?workspaceId={WorkspaceId}
 * API for a fetching Workflow's Reports, and it expects:
 *  - Required Path Parameter:
 *    - 'id': NextFlow Tower Workflow Id
 *  - Required Query Parameter:
 *    - 'laboratoryId': containing the LaboratoryId to retrieve the WorkspaceId & AccessToken
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Get required path parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new Error('Required id is missing');

    // Get required query parameter
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new Error('Required laboratoryId is missing');

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

    // Laboratory requires access to NextFlow Tower
    if (!laboratory.NextFlowTowerEnabled) {
      throw new MissingNextFlowTowerAccessError();
    }

    // Retrieve Seqera Cloud / NextFlow Tower AccessToken from SSM
    const getParameterResponse: GetParameterCommandOutput | void = await ssmService
      .getParameter({
        Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
        WithDecryption: true,
      })
      .catch((error: any) => {
        if (error instanceof ParameterNotFound) {
          throw new LaboratoryAccessTokenUnavailableError();
        } else {
          throw error;
        }
      });
    const accessToken: string | undefined = getParameterResponse ? getParameterResponse.Parameter?.Value : undefined;
    if (!accessToken) {
      throw new Error('Laboratory Access Token unavailable');
    }

    // Get Seqera API Base URL for Laboratory or default to platform-wide configured Seqera API Base URL
    const seqeraApiBaseUrl: string = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL;
    // Get Query Parameters for Seqera Cloud / NextFlow Tower APIs
    const apiQueryParameters: string = getNextFlowApiQueryParameters(event, laboratory.NextFlowTowerWorkspaceId);
    const response: DescribeWorkflowReportsResponse = await httpRequest<DescribeWorkflowReportsResponse>(
      `${seqeraApiBaseUrl}/workflow/${id}/reports?${apiQueryParameters}`,
      REST_API_METHOD.GET,
      { Authorization: `Bearer ${accessToken}` },
    );
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
