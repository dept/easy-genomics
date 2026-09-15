import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, RequiredIdNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { WorkflowRunPresetScopeSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-run-preset';
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

    const presetId: string = event.pathParameters?.id || '';
    if (presetId === '') {
      throw new RequiredIdNotFoundError();
    }

    // The sort key is composed of scope, owner and workflow, so all three are needed to locate the item.
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    const workflowId: string = event.queryStringParameters?.workflowId || '';
    const scope = WorkflowRunPresetScopeSchema.safeParse(event.queryStringParameters?.scope);
    if (laboratoryId === '' || workflowId === '' || !scope.success) {
      throw new InvalidRequestError('laboratoryId, workflowId and scope query parameters are required');
    }

    await authorizeLaboratoryPresetAccess(event, laboratoryService, laboratoryId);

    await workflowRunPresetService.deletePreset(
      {
        LaboratoryId: laboratoryId,
        WorkflowId: workflowId,
        Scope: scope.data,
        UserId: currentUserId,
      },
      presetId,
    );

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
