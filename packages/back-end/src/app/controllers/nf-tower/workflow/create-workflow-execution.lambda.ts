import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryAccessTokenUnavailableError,
  LaboratoryNotFoundError,
  MissingNextFlowTowerAccessError,
  RequiredIdNotFoundError,
  SeqeraApiError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  CreateWorkflowLaunchRequest,
  CreateWorkflowLaunchResponse,
} from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasWorkflowAccess } from '@BE/utils/laboratory-workflow-access-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * This POST /nf-tower/workflow/create-workflow-execution?laboratoryId={LaboratoryId}
 * API calls the NextFlow Tower POST /workflow/launch?workspaceId={WorkspaceId}
 * API to launch a specific Workflow (aka Pipeline Run), and it expects:
 *  - Required Query Parameter:
 *    - 'laboratoryId': containing the LaboratoryId to retrieve the WorkspaceId & AccessToken
 *  - Required Body JSON Payload:
 *    - this must match the CreateWorkflowLaunchRequest type definition and can
 *      be obtained for each respective Pipeline by calling the
 *      GET /nf-tower/pipeline/read-pipeline-launch-details/{Pipeline Id} API
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

    const pipelineId: string = event.queryStringParameters?.pipelineId || '';
    if (pipelineId === '') throw new RequiredIdNotFoundError('pipelineId');

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

    await assertLaboratoryHasWorkflowAccess(
      laboratory.LaboratoryId,
      'SEQERA',
      pipelineId,
      laboratoryWorkflowAccessService,
    );

    const rawBody = event.isBase64Encoded ? atob(event.body!) : event.body!;
    console.log('rawBody:', rawBody);

    const createWorkflowLaunchRequest: CreateWorkflowLaunchRequest = JSON.parse(rawBody);
    console.log('createWorkflowLaunchRequest:', createWorkflowLaunchRequest);

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
      throw new LaboratoryAccessTokenUnavailableError();
    }

    // Get Seqera API Base URL for Laboratory or default to platform-wide configured Seqera API Base URL
    const seqeraApiBaseUrl: string = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL || '';
    if (!seqeraApiBaseUrl) {
      throw new MissingNextFlowTowerAccessError();
    }
    // Get Query Parameters for Seqera Cloud / NextFlow Tower APIs
    const apiQueryParameters: string = getNextFlowApiQueryParameters(event, laboratory.NextFlowTowerWorkspaceId);
    const response: CreateWorkflowLaunchResponse = await httpRequest<CreateWorkflowLaunchResponse>(
      `${seqeraApiBaseUrl}/workflow/launch?${apiQueryParameters}`,
      REST_API_METHOD.POST,
      { Authorization: `Bearer ${accessToken}` },
      createWorkflowLaunchRequest, // Delegate request body validation to Seqera Cloud / NextFlow Tower
    ).catch((error: any) => {
      throw new SeqeraApiError(error.message);
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
