import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  EditWorkflowKeyOutputs,
  EditWorkflowKeyOutputsSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import {
  WorkflowKeyOutput,
  WorkflowKeyOutputs,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { authorizeLaboratoryKeyOutputsAccess } from '@BE/utils/workflow-key-output-utils';

const laboratoryService = new LaboratoryService();
const workflowKeyOutputsService = new WorkflowKeyOutputsService();

/**
 * POST /easy-genomics/workflow-key-outputs/edit-workflow-key-outputs
 *
 * Create or replace the lab-wide key-outputs definition for a workflow.
 * An empty KeyOutputs array clears previously declared roles.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];

    const request: EditWorkflowKeyOutputs = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!EditWorkflowKeyOutputsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    await authorizeLaboratoryKeyOutputsAccess(event, laboratoryService, request.LaboratoryId);

    const now = new Date().toISOString();
    const keyOutputs: WorkflowKeyOutput[] = request.KeyOutputs.map((item) => ({
      KeyOutputId: item.KeyOutputId || uuidv4(),
      Label: item.Label.trim(),
      Pattern: item.Pattern.trim(),
      ExamplePath: item.ExamplePath,
    }));

    const definition: WorkflowKeyOutputs = {
      LaboratoryId: request.LaboratoryId,
      WorkflowId: request.WorkflowId,
      WorkflowName: request.WorkflowName,
      Platform: request.Platform,
      SourceRunId: request.SourceRunId,
      KeyOutputs: keyOutputs,
      CreatedAt: now,
      CreatedBy: currentUserId,
      ModifiedAt: now,
      ModifiedBy: currentUserId,
    };

    const saved = await workflowKeyOutputsService.save(definition);
    return buildResponse(200, JSON.stringify(saved), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
