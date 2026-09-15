import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ListWorkflowRunPresetsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
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

    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    const workflowId: string = event.queryStringParameters?.workflowId || '';
    if (laboratoryId === '' || workflowId === '') {
      throw new InvalidRequestError('laboratoryId and workflowId query parameters are required');
    }

    await authorizeLaboratoryPresetAccess(event, laboratoryService, laboratoryId);

    const presets: ListWorkflowRunPresetsResponse = await workflowRunPresetService.listForWorkflow(
      laboratoryId,
      currentUserId,
      workflowId,
    );

    return buildResponse(200, JSON.stringify(presets), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
