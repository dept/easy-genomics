import { createHmac } from 'crypto';
import { buildClient, CommitmentPolicy, KmsKeyringNode } from '@aws-crypto/client-node';
import { AdminGetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ConfirmUserForgotPasswordRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-password';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { ConfirmUserForgotPasswordRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-password';
import { UserForgotPasswordJwt } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-verification-jwt';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { toByteArray } from 'base64-js';
import { JwtPayload } from 'jsonwebtoken';
import { CognitoIdpService } from '@BE/services/cognito-idp-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { verifyJwt } from '@BE/utils/jwt-utils';

const cryptoClient = buildClient(CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT);
const generatorKeyId = process.env.COGNITO_KMS_KEY_ID;
const keyIds = [process.env.COGNITO_KMS_KEY_ARN];
const keyring = new KmsKeyringNode({ generatorKeyId, keyIds });

const cognitoIdpService = new CognitoIdpService({ userPoolId: process.env.COGNITO_USER_POOL_ID });
const userService = new UserService();

export const handler: Handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Post Request Body
    const request: ConfirmUserForgotPasswordRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    // Data validation safety check
    if (!ConfirmUserForgotPasswordRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    // Verify JWT has not expired and signature is valid
    const jwtPayload: JwtPayload | string = verifyJwt(request.Token, process.env.JWT_SECRET_KEY);

    if (typeof jwtPayload === 'object') {
      // Check JWT RequestType is the expected 'UserForgotPasswordJwt'
      const payload: UserForgotPasswordJwt = <UserForgotPasswordJwt>jwtPayload;
      if (payload.RequestType !== 'UserForgotPassword') {
        throw new Error(`Invalid JWT RequestType: '${payload.RequestType}'`);
      }

      // Lookup User by Email to verify request
      const user: User | undefined = (await userService.queryByEmail(payload.Email)).shift();
      if (!user) {
        throw new Error(`Unable to find User record: '${payload.Email}'`);
      }
      if (user.Status === 'Inactive') {
        throw new Error('User has been deactivated. Please contact the System Administrator for assistance.');
      }

      const verification = createHmac('sha256', process.env.JWT_SECRET_KEY + payload.CreatedAt)
        .update(user.UserId + payload.Code)
        .digest('hex');
      if (payload.Verification !== verification) {
        throw new Error('User Forgot Password Verification invalid');
      } else {
        const response: AdminGetUserCommandOutput = await cognitoIdpService.adminGetUser(user.UserId);
        if (response.$metadata.httpStatusCode !== 200) {
          throw new Error(`Unable to find User record: '${payload.Email}'`);
        }
        if (!response.Enabled) {
          throw new Error('User has been deactivated. Please contact the System Administrator for assistance.');
        }

        // Decrypt the confirmationCode
        const { plaintext } = await cryptoClient.decrypt(keyring, toByteArray(payload.Code));
        const confirmationCode: string = plaintext.toString();

        // Update User's Password
        await cognitoIdpService.confirmForgotPassword(
          process.env.COGNITO_USER_POOL_CLIENT_ID,
          user.UserId,
          request.Password,
          confirmationCode,
        );
        return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
      }
    } else {
      throw new Error(`Unexpected response: ${jwtPayload}`);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
