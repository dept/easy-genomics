import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { UpdateLaboratoryWorkflowRunLimitsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import { Laboratory, WorkflowCostLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  costLimitsOrderError,
  resolveCostLimits,
  workflowRunLimitsKey,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    if (!event.body) throw new InvalidRequestError('Request body is missing');
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body)) : JSON.parse(event.body);
    const parsed = UpdateLaboratoryWorkflowRunLimitsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError(parsed.error.issues[0].message);
    const { Platform, WorkflowId, WorkflowName, CostWarnAboveUsd, CostBlockAboveUsd } = parsed.data;

    const existing: Laboratory = await laboratoryService.queryByLaboratoryId(id);

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, existing.OrganizationId))) {
      throw new UnauthorizedAccessError();
    }

    // A blank amount falls back to the lab's, so the order is checked on the amounts that will actually apply.
    const orderError = costLimitsOrderError(
      resolveCostLimits(existing.RunLimits, { CostWarnAboveUsd, CostBlockAboveUsd }),
      WorkflowName,
    );
    if (orderError) throw new InvalidRequestError(orderError);

    const hasAmounts = CostWarnAboveUsd !== undefined || CostBlockAboveUsd !== undefined;
    const limits: WorkflowCostLimits | undefined = hasAmounts
      ? {
          WorkflowName,
          ...(CostWarnAboveUsd !== undefined ? { CostWarnAboveUsd } : {}),
          ...(CostBlockAboveUsd !== undefined ? { CostBlockAboveUsd } : {}),
        }
      : undefined;

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];
    const updated: Laboratory = await laboratoryService.updateWorkflowRunLimits(
      existing,
      workflowRunLimitsKey(Platform, WorkflowId),
      limits,
      userId,
    );

    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
