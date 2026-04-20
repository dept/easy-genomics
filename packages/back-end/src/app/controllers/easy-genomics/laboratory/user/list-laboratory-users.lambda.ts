import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';

const laboratoryUserService = new LaboratoryUserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Query Parameter
    const organizationId: string | undefined = event.queryStringParameters?.organizationId;
    const laboratoryId: string | undefined = event.queryStringParameters?.laboratoryId;
    const userId: string | undefined = event.queryStringParameters?.userId;

    const response: LaboratoryUser[] = await listLaboratoryUsers(organizationId, laboratoryId, userId);

    if (response) {
      return buildResponse(200, JSON.stringify(response), event);
    } else {
      throw new Error(`Unable to find Laboratory Users: ${JSON.stringify(response)}`);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

export const listLaboratoryUsers = (
  organizationId?: string,
  laboratoryId?: string,
  userId?: string,
): Promise<LaboratoryUser[]> => {
  if (organizationId && !laboratoryId && !userId) {
    return laboratoryUserService.queryByOrganizationId(organizationId);
  } else if (laboratoryId && !organizationId && !userId) {
    return laboratoryUserService.queryByLaboratoryId(laboratoryId);
  } else if (userId && !organizationId && !laboratoryId) {
    return laboratoryUserService.queryByUserId(userId);
  } else {
    throw new InvalidRequestError();
  }
};
