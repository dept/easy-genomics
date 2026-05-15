import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
  UserNameTakenError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { UpdateUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { UserService } from '@BE/services/easy-genomics/user-service';

const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const userId = event.requestContext.authorizer.claims['cognito:username'];
    if (id !== userId) {
      throw new UnauthorizedAccessError();
    }

    // Put Request Body
    const request: User = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!UpdateUserSchema.safeParse(request).success) throw new InvalidRequestError();

    // Only the current User can change their own User details
    const existing: User | undefined = (
      await userService.queryByEmail(event.requestContext.authorizer.claims.email)
    ).shift();

    if (!existing) {
      throw new UnauthorizedAccessError();
    }

    // Update existing User record in Easy-Genomics User table
    const response: User | void = await userService
      .update(
        {
          ...existing,
          ...request,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: userId,
        },
        existing,
      )
      .catch((error: any) => {
        if (error instanceof TransactionCanceledException) {
          throw new UserNameTakenError();
        } else {
          throw error;
        }
      });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
