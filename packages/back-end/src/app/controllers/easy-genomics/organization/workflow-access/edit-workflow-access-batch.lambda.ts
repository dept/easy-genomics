import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { BatchUpdateLaboratoryWorkflowAccessRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-workflow-access';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { BatchUpdateLaboratoryWorkflowAccessRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';
import { laboratoryWorkflowAccessSortKey } from '@BE/utils/laboratory-workflow-access-utils';

const laboratoryService = new LaboratoryService();
const accessService = new LaboratoryWorkflowAccessService();

/**
 * POST /easy-genomics/organization/workflow-access/edit-workflow-access-batch?organizationId=
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const rawBody = event.isBase64Encoded ? atob(event.body!) : event.body!;
    const parsed: unknown = JSON.parse(rawBody || '{}');
    if (!BatchUpdateLaboratoryWorkflowAccessRequestSchema.safeParse(parsed).success) {
      throw new InvalidRequestError();
    }
    const body = parsed as BatchUpdateLaboratoryWorkflowAccessRequest;

    const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);
    const labById = new Map(laboratories.map((l) => [l.LaboratoryId, l]));

    for (const change of body.assignments) {
      const lab = labById.get(change.laboratoryId);
      if (!lab || lab.OrganizationId !== organizationId) {
        throw new InvalidRequestError('laboratoryId does not belong to organization');
      }
    }

    for (const change of body.assignments) {
      const lab = labById.get(change.laboratoryId)!;
      const defaultOn = lab.EnableNewWorkflowsByDefault === true;
      const sortKey = laboratoryWorkflowAccessSortKey(change.platform, change.workflowId);
      if (change.granted) {
        if (defaultOn) {
          await accessService.remove(change.laboratoryId, change.platform, change.workflowId);
        } else {
          await accessService.upsert({
            LaboratoryId: change.laboratoryId,
            WorkflowKey: sortKey,
            OrganizationId: organizationId,
            WorkflowName: change.workflowName,
            Effect: 'ALLOW',
          });
        }
      } else if (defaultOn) {
        await accessService.upsert({
          LaboratoryId: change.laboratoryId,
          WorkflowKey: sortKey,
          OrganizationId: organizationId,
          WorkflowName: change.workflowName,
          Effect: 'DENY',
        });
      } else {
        await accessService.remove(change.laboratoryId, change.platform, change.workflowId);
      }
    }

    return buildResponse(200, JSON.stringify({ ok: true }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
