import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { UpdateLaboratoryDataTagSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/update-tag';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const taggingService = new LaboratoryDataTaggingService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const tagId = event.pathParameters?.id || '';
    if (!tagId) throw new RequiredIdNotFoundError();

    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!UpdateLaboratoryDataTagSchema.safeParse(body).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await laboratoryService.queryByLaboratoryId(body.LaboratoryId);
    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];
    const updated = await taggingService.updateTag(body.LaboratoryId, tagId, userId, body.Name, body.ColorHex);
    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: any) {
    console.error(err);
    if (err?.message === 'A tag with this name already exists') {
      return buildResponse(409, JSON.stringify({ message: err.message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
