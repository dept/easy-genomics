import { RequestLaboratoryUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';

const laboratoryUserService = new LaboratoryUserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Post Request Body
    const request: LaboratoryUser = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!RequestLaboratoryUserSchema.safeParse(request).success) throw new InvalidRequestError();

    const existing: LaboratoryUser = await laboratoryUserService.get(request.LaboratoryId, request.UserId);
    return buildResponse(200, JSON.stringify(existing), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
