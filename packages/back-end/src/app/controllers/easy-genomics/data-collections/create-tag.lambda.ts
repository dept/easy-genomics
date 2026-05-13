import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateLaboratoryDataTagSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-tag';
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
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!CreateLaboratoryDataTagSchema.safeParse(body).success) {
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
    const kind = body.Kind ?? 'standard';
    const tag = await taggingService.createTag(laboratory, userId, body.Name, body.ColorHex, kind);
    return buildResponse(200, JSON.stringify(tag), event);
  } catch (err: any) {
    console.error(err);
    if (err instanceof InvalidRequestError || err instanceof UnauthorizedAccessError) {
      return buildErrorResponse(err, event);
    }
    if (err?.message === 'A tag with this name already exists') {
      return buildResponse(409, JSON.stringify({ message: err.message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
