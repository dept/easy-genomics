import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryAccessTokenUnavailableError,
  LaboratoryNotFoundError,
  MissingNextFlowTowerAccessError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { ListPipelinesResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { isWorkflowAccessAllowed } from '@BE/utils/laboratory-workflow-access-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * Retrieves every Seqera pipeline across all pages (preserving any caller-supplied
 * search / workspaceId params) so the workflow-access filter is applied to the full
 * set rather than a single page.
 */
async function listAllPipelines(
  seqeraApiBaseUrl: string,
  apiQueryParameters: string,
  accessToken: string,
): Promise<ListPipelinesResponse> {
  const pipelines: NonNullable<ListPipelinesResponse['pipelines']> = [];
  const seen = new Set<string>();
  let firstResponse: ListPipelinesResponse | undefined;
  let offset = 0;
  const max = 100;

  for (;;) {
    const params = new URLSearchParams(apiQueryParameters);
    params.set('max', String(max));
    params.set('offset', String(offset));

    const response: ListPipelinesResponse = await httpRequest<ListPipelinesResponse>(
      `${seqeraApiBaseUrl}/pipelines?${params.toString()}`,
      REST_API_METHOD.GET,
      { Authorization: `Bearer ${accessToken}` },
    );
    if (!firstResponse) {
      firstResponse = response;
    }

    const page = response.pipelines ?? [];
    if (!page.length) {
      break;
    }
    for (const p of page) {
      const id = p.pipelineId != null ? String(p.pipelineId) : undefined;
      if (id != null && seen.has(id)) {
        continue;
      }
      if (id != null) {
        seen.add(id);
      }
      pipelines.push(p);
    }

    offset += page.length;
    if (page.length < max || (response.totalSize != null && offset >= response.totalSize)) {
      break;
    }
  }

  return { ...(firstResponse ?? {}), pipelines, totalSize: pipelines.length };
}

/**
 * This GET /nf-tower/pipeline/list-pipelines?laboratoryId={LaboratoryId} API
 * queries the NextFlow Tower GET /pipelines?workspaceId={WorkspaceId} API for a
 * list of Pipelines, and it expects:
 *  - Required Query Parameter:
 *    - 'laboratoryId': containing the LaboratoryId to retrieve the WorkspaceId & AccessToken
 *  - Optional Query Parameters:
 *    - 'max': pagination number of results
 *    - 'offset': pagination results offset index
 *    - 'search': string to search by the Pipelines name attribute (e.g. nf-core-viralrecon)
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
      throw new LaboratoryAccessTokenUnavailableError();
    }

    // Get Seqera API Base URL for Laboratory or default to platform-wide configured Seqera API Base URL
    const seqeraApiBaseUrl: string = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL;
    // Get Query Parameters for Seqera Cloud / NextFlow Tower APIs (preserves search + workspaceId)
    const apiQueryParameters: string = getNextFlowApiQueryParameters(event, laboratory.NextFlowTowerWorkspaceId);

    // Fetch every page of pipelines before applying the workflow-access filter.
    // Filtering only the first page would hide any granted pipeline beyond that
    // page from every user, even though it appears in the (fully paginated)
    // admin workflow catalog.
    const response: ListPipelinesResponse = await listAllPipelines(seqeraApiBaseUrl, apiQueryParameters, accessToken);

    const accessRows = await laboratoryWorkflowAccessService.listByLaboratoryId(laboratoryId);
    const pipelines = (response.pipelines ?? []).filter(
      (p) => p.pipelineId != null && isWorkflowAccessAllowed(laboratory, accessRows, 'SEQERA', String(p.pipelineId)),
    );

    return buildResponse(200, JSON.stringify({ ...response, pipelines, totalSize: pipelines.length }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
