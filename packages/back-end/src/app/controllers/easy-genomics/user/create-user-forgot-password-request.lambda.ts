import { AdminGetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  UnauthorizedAccessError,
  UserNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { CreateUserForgotPasswordRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-password';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { CreateUserForgotPasswordRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-password';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { CognitoIdpService } from '@BE/services/cognito-idp-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const cognitoIdpService = new CognitoIdpService({ userPoolId: process.env.COGNITO_USER_POOL_ID });
const userService: UserService = new UserService();

export const handler: Handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: CreateUserForgotPasswordRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    // Data validation safety check
    if (!CreateUserForgotPasswordRequestSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Verify User
    const user: User | undefined = (await userService.queryByEmail(request.Email)).shift();

    if (!user) {
      throw new UserNotFoundError(`'${request.Email}' not found`);
    }

    if (user.Status === 'Invited' || user.Status === 'Inactive') {
      throw new UnauthorizedAccessError(`'${request.Email}' Status '${user.Status}'`);
    }

    // Retrieve Cognito User Account and initiate Cognito's forgot password workflow
    const cognitoUser: AdminGetUserCommandOutput = await cognitoIdpService.adminGetUser(request.Email);

    if (!cognitoUser.Enabled) {
      throw new UnauthorizedAccessError(`'${request.Email}' Cognito Account disabled`);
    }

    await cognitoIdpService.forgotPassword(process.env.COGNITO_USER_POOL_CLIENT_ID, request.Email);
    return buildResponse(200, JSON.stringify({ Status: 'success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildResponse(200, JSON.stringify({ Status: 'success' }), event); // Return false positive to prevent snooping
  }
};
