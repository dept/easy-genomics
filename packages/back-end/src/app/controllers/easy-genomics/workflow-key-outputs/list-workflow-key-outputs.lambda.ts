import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ListWorkflowKeyOutputsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { authorizeLaboratoryKeyOutputsAccess } from '@BE/utils/workflow-key-output-utils';

const laboratoryService = new LaboratoryService();
const workflowKeyOutputsService = new WorkflowKeyOutputsService();

/**
 * GET /easy-genomics/workflow-key-outputs/list-workflow-key-outputs
 *   ?laboratoryId={LaboratoryId}&workflowId={WorkflowId}
 *
 * Returns the lab's key-outputs definition for this workflow, or an empty
 * KeyOutputs array when nothing has been declared yet.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    const workflowId: string = event.queryStringParameters?.workflowId || '';
    if (laboratoryId === '' || workflowId === '') {
      throw new InvalidRequestError('laboratoryId and workflowId query parameters are required');
    }

    await authorizeLaboratoryKeyOutputsAccess(event, laboratoryService, laboratoryId);

    const existing = await workflowKeyOutputsService.get(laboratoryId, workflowId);
    const response: ListWorkflowKeyOutputsResponse = existing
      ? {
          LaboratoryId: existing.LaboratoryId,
          WorkflowId: existing.WorkflowId,
          WorkflowName: existing.WorkflowName,
          Platform: existing.Platform,
          SourceRunId: existing.SourceRunId,
          KeyOutputs: existing.KeyOutputs,
          CreatedAt: existing.CreatedAt,
          ModifiedAt: existing.ModifiedAt,
        }
      : {
          LaboratoryId: laboratoryId,
          WorkflowId: workflowId,
          KeyOutputs: [],
        };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
