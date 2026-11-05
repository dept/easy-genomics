import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { UpdateLaboratoryRunLimitsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
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
    const parsed = UpdateLaboratoryRunLimitsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError(parsed.error.issues[0].message);

    const existing: Laboratory = await laboratoryService.queryByLaboratoryId(id);

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, existing.OrganizationId))) {
      throw new UnauthorizedAccessError();
    }

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];
    const updated: Laboratory = await laboratoryService.updateRunLimits(existing, parsed.data, userId);

    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
