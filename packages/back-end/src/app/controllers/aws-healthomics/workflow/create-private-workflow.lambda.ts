import { CreateWorkflowCommandInput } from '@aws-sdk/client-omics';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateWorkflowRequest } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const CREATE_WORKFLOW_ALLOWED_KEYS = new Set([
  'name',
  'description',
  'engine',
  'definitionUri',
  'main',
  'requestId',
  'parameterTemplate',
  'storageCapacity',
  'storageType',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCreateWorkflowRequest(request: unknown): request is CreateWorkflowRequest {
  if (!isObject(request)) return false;

  const keys = Object.keys(request);
  if (keys.some((key) => !CREATE_WORKFLOW_ALLOWED_KEYS.has(key))) return false;

  const { name, description, engine, definitionUri, main, requestId, parameterTemplate, storageCapacity, storageType } =
    request;

  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64) return false;
  if (description !== undefined && (typeof description !== 'string' || description.length > 256)) return false;
  if (engine !== 'WDL' && engine !== 'NEXTFLOW' && engine !== 'CWL') return false;
  if (typeof definitionUri !== 'string' || definitionUri.trim().length < 1 || definitionUri.length > 2048) return false;
  if (typeof main !== 'string' || main.trim().length < 1 || main.length > 2048) return false;
  if (typeof requestId !== 'string' || requestId.trim().length < 1 || requestId.length > 127) return false;
  if (storageType !== undefined && storageType !== 'STATIC' && storageType !== 'DYNAMIC') return false;
  if (
    storageCapacity !== undefined &&
    (typeof storageCapacity !== 'number' ||
      !Number.isInteger(storageCapacity) ||
      storageCapacity <= 0 ||
      storageCapacity > 100000)
  ) {
    return false;
  }
  if (parameterTemplate !== undefined && !isObject(parameterTemplate)) return false;

  return true;
}

/**
 * POST /aws-healthomics/workflow/create-private-workflow?laboratoryId={LaboratoryId}
 * Creates a new private AWS HealthOmics workflow for a laboratory.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: CreateWorkflowRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!isValidCreateWorkflowRequest(request)) throw new InvalidRequestError();

    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new UnauthorizedAccessError('Laboratory does not have AWS HealthOmics enabled');
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

    const userId: string | undefined =
      event.requestContext.authorizer?.claims?.sub ?? event.requestContext.authorizer?.claims?.['cognito:username'];
    const userEmail: string | undefined = event.requestContext.authorizer?.claims?.email;
    const omicsUserId = userId ?? 'unknown-user';
    const omicsService = await createOmicsServiceForLab(
      laboratory.LaboratoryId,
      laboratory.OrganizationId,
      omicsUserId,
    );

    const response = await omicsService.createWorkflow(<CreateWorkflowCommandInput>{
      ...request,
      tags: {
        LaboratoryId: laboratory.LaboratoryId,
        OrganizationId: laboratory.OrganizationId,
        WorkflowName: request.name,
        ...(userId && { UserId: userId }),
        ...(userEmail && { UserEmail: userEmail }),
        Application: 'easy-genomics',
        Platform: 'AWS HealthOmics',
      },
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
