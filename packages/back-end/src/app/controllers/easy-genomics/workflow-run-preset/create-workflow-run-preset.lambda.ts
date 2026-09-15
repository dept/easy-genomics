import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  CreateWorkflowRunPreset,
  CreateWorkflowRunPresetSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-run-preset';
import { WorkflowRunPreset } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { WorkflowRunPresetService } from '@BE/services/easy-genomics/workflow-run-preset-service';
import { authorizeLaboratoryPresetAccess } from '@BE/utils/workflow-run-preset-utils';

const laboratoryService = new LaboratoryService();
const workflowRunPresetService = new WorkflowRunPresetService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    const currentUserEmail: string = event.requestContext.authorizer.claims.email;

    const request: CreateWorkflowRunPreset = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!CreateWorkflowRunPresetSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    await authorizeLaboratoryPresetAccess(event, laboratoryService, request.LaboratoryId);

    const preset: WorkflowRunPreset = await workflowRunPresetService.createPreset(
      {
        LaboratoryId: request.LaboratoryId,
        WorkflowId: request.WorkflowId,
        Scope: request.Scope,
        UserId: currentUserId,
      },
      request.Name,
      request.Params,
      currentUserEmail,
    );

    return buildResponse(200, JSON.stringify(preset), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
