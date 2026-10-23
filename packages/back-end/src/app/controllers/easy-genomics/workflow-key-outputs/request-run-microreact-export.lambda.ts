import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunMicroreactExport,
  RequestRunMicroreactExportSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import { RequestRunMicroreactExportResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { MicroreactExportService } from '@BE/services/easy-genomics/microreact-export-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const microreactExportService = new MicroreactExportService();

/**
 * POST /easy-genomics/workflow-key-outputs/request-run-microreact-export
 *
 * Queues a new Microreact project for a completed run's key outputs, using the
 * workflow's saved Microreact roles. Any lab member can send.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestRunMicroreactExport = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!RequestRunMicroreactExportSchema.safeParse(request).success) throw new InvalidRequestError();

    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, request.OrganizationId) ||
        validateLaboratoryManagerAccess(event, request.OrganizationId, request.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, request.OrganizationId, request.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const response: RequestRunMicroreactExportResponse = await microreactExportService.requestExport(request);
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
