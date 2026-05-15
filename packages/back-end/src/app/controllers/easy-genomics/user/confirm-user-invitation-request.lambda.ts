import { createHmac } from 'crypto';
import { buildClient, CommitmentPolicy, KmsKeyringNode } from '@aws-crypto/client-node';
import { InitiateAuthCommandOutput, NotAuthorizedException } from '@aws-sdk/client-cognito-identity-provider';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  UnauthorizedAccessError,
  UserNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { ERROR_MESSAGES } from '@easy-genomics/shared-lib/src/app/constants/errorMessages';
import { ConfirmUpdateUserInvitationRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-invitation';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { ConfirmUserInvitationRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import { UserInvitationJwt } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-verification-jwt';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { toByteArray } from 'base64-js';
import { JwtPayload } from 'jsonwebtoken';
import { CognitoIdpService } from '@BE/services/cognito-idp-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { verifyJwt } from '@BE/utils/jwt-utils';

const cryptoClient = buildClient(CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT);
const generatorKeyId = process.env.COGNITO_KMS_KEY_ID;
const keyIds = [process.env.COGNITO_KMS_KEY_ARN];
const keyring = new KmsKeyringNode({ generatorKeyId, keyIds });

const cognitoIdpService = new CognitoIdpService({ userPoolId: process.env.COGNITO_USER_POOL_ID });
const organizationUserService = new OrganizationUserService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

export const handler: Handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: ConfirmUserInvitationRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    // Data validation safety check
    if (!ConfirmUpdateUserInvitationRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    // Verify JWT has not expired and signature is valid
    const jwtPayload: JwtPayload | string = verifyJwt(request.Token, process.env.JWT_SECRET_KEY);

    if (typeof jwtPayload !== 'object') {
      throw new InvalidRequestError(`Unexpected User Invitation: ${jwtPayload}`);
    }

    // Check JWT RequestType is the expected 'UserInvitationJwt'
    const payload: UserInvitationJwt = <UserInvitationJwt>jwtPayload;
    if (payload.RequestType !== 'NewUserInvitation' && payload.RequestType !== 'ExistingUserInvitation') {
      throw new InvalidRequestError(`Unexpected User Invitation request type: '${payload.RequestType}'`);
    }

    // Lookup User by Email to verify request
    const user: User | undefined = (await userService.queryByEmail(payload.Email)).shift();
    if (!user) {
      throw new UserNotFoundError();
    }
    if (user.Status === 'Inactive') {
      throw new UnauthorizedAccessError('Please contact the System Administrator for assistance.');
    }

    const verification = createHmac('sha256', process.env.JWT_SECRET_KEY + payload.CreatedAt)
      .update(user.UserId + payload.OrganizationId)
      .digest('hex');
    if (payload.Verification !== verification) {
      throw new InvalidRequestError('Failed to verify User Invitation');
    }

    // Lookup OrganizationUser access mapping to check invitation has not already been activated / restricted.
    const organizationUser: OrganizationUser = await organizationUserService.get(payload.OrganizationId, user.UserId);
    if (organizationUser.Status === 'Active') {
      throw new UnauthorizedAccessError(ERROR_MESSAGES.invitationAlreadyActivated);
    } else if (organizationUser.Status === 'Inactive') {
      throw new UnauthorizedAccessError(
        'User access to Organization has been deactivated. Please contact the System Administrator for assistance.',
      );
    }

    if (payload.RequestType === 'ExistingUserInvitation') {
      // Activate Existing User invited to an Organization
      await platformUserService.editExistingUserAccessToOrganization(
        {
          ...user,
          Status: 'Active',
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: user.UserId,
        },
        {
          ...organizationUser,
          Status: 'Active',
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: user.UserId,
        },
      );
    } else {
      // Activate New User invited to the Platform and an Organization
      if (user.Status === 'Invited') {
        const temporaryPassword: string | undefined = payload.TemporaryPassword;
        if (!temporaryPassword) {
          throw new InvalidRequestError('Required temporary password missing in User Invitation');
        }

        // Decrypt the temporaryPassword
        const { plaintext } = await cryptoClient.decrypt(keyring, toByteArray(temporaryPassword));

        // Login with temporaryPassword to obtain accessToken and complete auth challenge set new password
        const response: InitiateAuthCommandOutput | void = await cognitoIdpService
          .initiateAuth(process.env.COGNITO_USER_POOL_CLIENT_ID, user.Email, plaintext.toString())
          .catch((error: any) => {
            if (error instanceof NotAuthorizedException) {
              throw new UnauthorizedAccessError(
                'User Invitation no longer valid. Please request the User Invitation to be re-sent.',
              );
            } else {
              throw error;
            }
          });
        if (!response || !response.Session) {
          throw new UnauthorizedAccessError('Unable to obtain authentication access token');
        }

        await cognitoIdpService
          .respondToAuthChallenge(
            process.env.COGNITO_USER_POOL_CLIENT_ID,
            response.Session,
            user.Email,
            request.Password,
          )
          .then(async () => {
            // Identify the User's existing OrganizationUser records with 'Invited' Status to update to 'Active'
            const orgUserRecordsToActivate: OrganizationUser[] = (
              await organizationUserService.queryByUserId(user.UserId)
            )
              .filter((orgUser: OrganizationUser) => orgUser.Status === 'Invited')
              .map((orgUser: OrganizationUser) => {
                return {
                  ...orgUser,
                  Status: 'Active',
                  ModifiedAt: new Date().toISOString(),
                  ModifiedBy: user.UserId,
                };
              });

            await Promise.all([
              // Update Cognito User's email to verified
              cognitoIdpService.adminUpdateUserEmailVerified(user.UserId, true),
              // Update User's Status to 'Active', set the supplied names, and activate list of OrganizationUser records
              platformUserService.editExistingUserAccessToOrganizations(
                {
                  ...user,
                  FirstName: request.FirstName,
                  LastName: request.LastName,
                  Status: 'Active',
                  ModifiedAt: new Date().toISOString(),
                  ModifiedBy: user.UserId,
                },
                orgUserRecordsToActivate,
              ),
            ]);
          })
          .catch((err) => {
            throw new UnauthorizedAccessError(err.message);
          });
      }
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
