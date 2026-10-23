import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  EditWorkflowKeyOutputDelivery,
  EditWorkflowKeyOutputDeliverySchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import {
  WorkflowKeyOutput,
  WorkflowKeyOutputMicroreactDelivery,
  WorkflowKeyOutputs,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { parseKeyOutputDeliveryUri } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-delivery';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { isPlatformKeyOutputDeliveryBucket } from '@BE/utils/workflow-key-output-delivery';
import { authorizeLaboratoryManagerKeyOutputsAccess } from '@BE/utils/workflow-key-output-utils';

const laboratoryService = new LaboratoryService();
const workflowKeyOutputsService = new WorkflowKeyOutputsService();

/**
 * POST /easy-genomics/workflow-key-outputs/edit-workflow-key-output-delivery
 *
 * Lab-wide setting: copy this workflow's declared key outputs to one external
 * S3 URI, and/or send them to Microreact, when a HealthOmics run completes
 * successfully. A request without `Microreact` keeps the saved Microreact roles.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    const request: EditWorkflowKeyOutputDelivery = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!EditWorkflowKeyOutputDeliverySchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    await authorizeLaboratoryManagerKeyOutputsAccess(event, laboratoryService, request.LaboratoryId);

    const destination = request.DestinationUri ? parseKeyOutputDeliveryUri(request.DestinationUri) : null;
    if (destination && isPlatformKeyOutputDeliveryBucket(destination.bucket)) {
      throw new InvalidRequestError('Destination cannot be an Easy Genomics platform bucket');
    }

    const existing = await workflowKeyOutputsService.get(request.LaboratoryId, request.WorkflowId);
    const microreact = request.Microreact ?? existing?.Delivery?.Microreact;
    if (microreact && !microreactRolesAreDeclared(microreact, existing?.KeyOutputs ?? [])) {
      throw new InvalidRequestError('Microreact roles must be key outputs declared for this workflow');
    }
    const now = new Date().toISOString();
    const definition: WorkflowKeyOutputs = {
      LaboratoryId: request.LaboratoryId,
      WorkflowId: request.WorkflowId,
      WorkflowName: existing?.WorkflowName,
      Platform: existing?.Platform ?? 'AWS HealthOmics',
      SourceRunId: existing?.SourceRunId,
      KeyOutputs: existing?.KeyOutputs ?? [],
      Delivery: {
        Enabled: request.Enabled,
        DestinationUri: destination ? `s3://${destination.bucket}/${destination.prefix}` : undefined,
        ...(microreact ? { Microreact: microreact } : {}),
      },
      CreatedAt: existing?.CreatedAt ?? now,
      CreatedBy: existing?.CreatedBy ?? currentUserId,
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

function microreactRolesAreDeclared(
  microreact: WorkflowKeyOutputMicroreactDelivery,
  keyOutputs: WorkflowKeyOutput[],
): boolean {
  const declared = new Set(keyOutputs.map((output) => output.KeyOutputId));
  const roles = [microreact.MetadataKeyOutputId, ...(microreact.TreeKeyOutputIds ?? [])].filter(Boolean);
  return roles.every((id) => declared.has(id!));
}
