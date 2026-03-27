import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { ListComputeEnvsResponse } from '@easy-genomics/shared-lib/lib/app/types/nf-tower/nextflow-tower-api';
import {
  UpdateLaboratory,
  UpdateLaboratorySchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryAccessTokenUnavailableError,
  LaboratoryNameTakenError,
  LaboratorySeqeraCredentialsIncorrectError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SsmService } from '@BE/services/ssm-service';
import { validateOrganizationAdminAccess } from '@BE/utils/auth-utils';
import { httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Put Request Body
    const request: UpdateLaboratory = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!UpdateLaboratorySchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Lookup by LaboratoryId to confirm existence before updating
    const existing: Laboratory = await laboratoryService.queryByLaboratoryId(id);

    // Only Organisation Admins are allowed to edit laboratories
    if (!validateOrganizationAdminAccess(event, existing.OrganizationId)) {
      throw new UnauthorizedAccessError();
    }

    if (
      request.NextFlowTowerEnabled &&
      !(await validateExistingNextFlowIntegration(
        existing,
        request.NextFlowTowerApiBaseUrl,
        request.NextFlowTowerWorkspaceId,
        request.NextFlowTowerAccessToken,
      ))
    ) {
      throw new LaboratorySeqeraCredentialsIncorrectError();
    }

    const response = await laboratoryService
      .update(
        {
          ...existing,
          Name: request.Name,
          Description: request.Description,
          Status: 'Active',
          S3Bucket: request.S3Bucket, // S3 Bucket Full Name
          AwsHealthOmicsEnabled: request.AwsHealthOmicsEnabled,
          NextFlowTowerEnabled: request.NextFlowTowerEnabled,
          NextFlowTowerApiBaseUrl: request.NextFlowTowerApiBaseUrl,
          NextFlowTowerWorkspaceId: request.NextFlowTowerWorkspaceId,
          RunRetentionMonths: request.RunRetentionMonths,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: userId,
        },
        existing,
      )
      .catch((error: any) => {
        if (error instanceof TransactionCanceledException) {
          throw new LaboratoryNameTakenError();
        } else {
          throw error;
        }
      });

    // Update NextFlow AccessToken in SSM if new value supplied
    if (request.NextFlowTowerAccessToken) {
      await ssmService.putParameter({
        Name: `/easy-genomics/organization/${existing.OrganizationId}/laboratory/${existing.LaboratoryId}/nf-access-token`,
        Description: `Easy Genomics Laboratory ${existing.LaboratoryId} NF AccessToken`,
        Value: request.NextFlowTowerAccessToken,
        Type: 'SecureString',
        Overwrite: true,
      });
    }

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

async function validateExistingNextFlowIntegration(
  laboratory: Laboratory,
  baseApiUrl?: string,
  workspaceId?: string,
  accessToken?: string,
): Promise<boolean> {
  // Existing integration requires at minimum the Seqera BaseApiUrl
  if (!baseApiUrl || baseApiUrl === '') {
    return false;
  }

  if (!accessToken || accessToken === '') {
    try {
      const getNextFlowAccessToken: GetParameterCommandOutput = await ssmService.getParameter({
        Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
        WithDecryption: true,
      });
      if (!getNextFlowAccessToken.Parameter || !getNextFlowAccessToken.Parameter.Value) {
        throw new InvalidRequestError();
      }
      accessToken = getNextFlowAccessToken.Parameter.Value;
    } catch (err: any) {
      throw new LaboratoryAccessTokenUnavailableError('Could not find access token for lab');
    }
  }

  // Build Query Parameters for calling NextFlow Tower
  const apiParameters: URLSearchParams = new URLSearchParams();
  apiParameters.set('workspaceId', `${workspaceId || ''}`); // WorkspaceId can be empty

  const nfResponse: ListComputeEnvsResponse = await httpRequest<ListComputeEnvsResponse>(
    `${baseApiUrl}/compute-envs?${apiParameters.toString()}`,
    REST_API_METHOD.GET,
    { Authorization: `Bearer ${accessToken}` },
  ).catch(() => {
    throw new LaboratorySeqeraCredentialsIncorrectError();
  });
  return !!nfResponse;
}
