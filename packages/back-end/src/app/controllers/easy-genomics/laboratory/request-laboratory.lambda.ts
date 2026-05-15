import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { RequestLaboratorySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { validateOrganizationAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: Laboratory = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!RequestLaboratorySchema.safeParse(request).success) throw new InvalidRequestError();

    //  Users with access to the Laboratory can view the organization
    if (!validateOrganizationAccess(event, request.OrganizationId, request.LaboratoryId)) {
      throw new UnauthorizedAccessError();
    }

    const response: Laboratory = await laboratoryService.get(request.OrganizationId, request.LaboratoryId);
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
