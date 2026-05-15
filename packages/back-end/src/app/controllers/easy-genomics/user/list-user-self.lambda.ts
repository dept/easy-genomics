import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import { UnauthorizedAccessError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { UserService } from '@BE/services/easy-genomics/user-service';

const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const tokenClaims = event.requestContext.authorizer?.claims || {};
    const tokenUserId = tokenClaims.UserId;
    const tokenEmail = tokenClaims.email;

    let response: User | undefined;

    if (tokenUserId) {
      response = await userService.get(tokenUserId);
    } else if (tokenEmail) {
      // Backward-compatible fallback while users still have tokens without UserId claim
      response = (await userService.queryByEmail(tokenEmail)).shift();
    } else {
      throw new UnauthorizedAccessError();
    }
    if (!response) {
      throw new UnauthorizedAccessError();
    }

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
