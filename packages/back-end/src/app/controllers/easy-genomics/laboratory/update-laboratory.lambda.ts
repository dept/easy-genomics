import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { ListComputeEnvsResponse } from '@easy-genomics/shared-lib/lib/app/types/nf-tower/nextflow-tower-api';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryAccessTokenUnavailableError,
  LaboratoryNameTakenError,
  LaboratorySeqeraCredentialsIncorrectError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  UpdateLaboratory,
  UpdateLaboratorySchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { migrateS3AccessOnDefaultModeChange } from '@BE/services/easy-genomics/laboratory-s3-access-default-migration';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { migrateWorkflowAccessOnDefaultModeChange } from '@BE/services/easy-genomics/laboratory-workflow-access-default-migration';
import { SsmService } from '@BE/services/ssm-service';
import { validateOrganizationAdminAccess } from '@BE/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import { httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();
const s3AccessService = new LaboratoryS3AccessService();

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

    if (request.S3Bucket) {
      await assertLaboratoryHasS3BucketAccess(
        {
          ...existing,
          EnableNewBucketsByDefault: request.EnableNewBucketsByDefault ?? existing.EnableNewBucketsByDefault,
        },
        request.S3Bucket,
        s3AccessService,
      );
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
          EnableNewWorkflowsByDefault: request.EnableNewWorkflowsByDefault ?? existing.EnableNewWorkflowsByDefault,
          EnableNewBucketsByDefault: request.EnableNewBucketsByDefault ?? existing.EnableNewBucketsByDefault,
          // Map LLM settings directly from the request (not `?? existing`) so selecting
          // "None" (sent as undefined) clears the field via the full-item PUT overwrite.
          HealthOmicsLlmProvider: request.HealthOmicsLlmProvider,
          HealthOmicsLlmModelId: request.HealthOmicsLlmModelId,
          SeqeraLlmProvider: request.SeqeraLlmProvider,
          SeqeraLlmModelId: request.SeqeraLlmModelId,
          // Same direct-mapping rationale: an unchecked toggle (undefined) clears the flag.
          HealthOmicsLogEnrichmentEnabled: request.HealthOmicsLogEnrichmentEnabled,
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

    const previousDefaultOn = existing.EnableNewWorkflowsByDefault === true;
    const nextDefaultOn = response.EnableNewWorkflowsByDefault === true;
    if (previousDefaultOn !== nextDefaultOn) {
      await migrateWorkflowAccessOnDefaultModeChange({
        organizationId: existing.OrganizationId,
        laboratoryId: existing.LaboratoryId,
        previousDefaultOn,
        nextDefaultOn,
      });
    }

    const previousBucketsDefaultOn = existing.EnableNewBucketsByDefault === true;
    const nextBucketsDefaultOn = response.EnableNewBucketsByDefault === true;
    if (previousBucketsDefaultOn !== nextBucketsDefaultOn) {
      await migrateS3AccessOnDefaultModeChange({
        organizationId: existing.OrganizationId,
        laboratoryId: existing.LaboratoryId,
        previousDefaultOn: previousBucketsDefaultOn,
        nextDefaultOn: nextBucketsDefaultOn,
      });
    }

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

    if (request.GitHubAccessToken) {
      await ssmService.putParameter({
        Name: `/easy-genomics/organization/${existing.OrganizationId}/laboratory/${existing.LaboratoryId}/github-access-token`,
        Description: `Easy Genomics Laboratory ${existing.LaboratoryId} GitHub AccessToken`,
        Value: request.GitHubAccessToken,
        Type: 'SecureString',
        Overwrite: true,
      });
    }

    // Update BYOK LLM API keys per integration if new values were supplied.
    // Absent on requests that only flip toggles, so existing keys are preserved.
    if (request.HealthOmicsLlmApiKey) {
      await ssmService.putParameter({
        Name: `/easy-genomics/organization/${existing.OrganizationId}/laboratory/${existing.LaboratoryId}/llm-api-key-healthomics`,
        Description: `Easy Genomics Laboratory ${existing.LaboratoryId} HealthOmics BYOK LLM API key`,
        Value: request.HealthOmicsLlmApiKey,
        Type: 'SecureString',
        Overwrite: true,
      });
    }
    if (request.SeqeraLlmApiKey) {
      await ssmService.putParameter({
        Name: `/easy-genomics/organization/${existing.OrganizationId}/laboratory/${existing.LaboratoryId}/llm-api-key-seqera`,
        Description: `Easy Genomics Laboratory ${existing.LaboratoryId} Seqera BYOK LLM API key`,
        Value: request.SeqeraLlmApiKey,
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
