import { createHmac } from 'crypto';
import {
  UserForgotPasswordJwt,
  UserInvitationJwt,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-verification-jwt';
import { Handler } from 'aws-lambda';
import { CustomEmailSenderTriggerEvent } from 'aws-lambda/trigger/cognito-user-pool-trigger/custom-email-sender';
import { SesService } from '../../services/ses-service';
import { generateJwt } from '../../utils/jwt-utils';

const sesService = new SesService({
  accountId: process.env.ACCOUNT_ID,
  domainName: process.env.DOMAIN_NAME,
  region: process.env.REGION,
  envType: process.env.ENV_TYPE,
  envName: process.env.ENV_NAME,
});

/**
 * This auth lambda function is triggered by the Cognito Custom-Email-Sender Event:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-custom-message.html
 *
 * @param event
 */
export const handler: Handler = async (
  event: CustomEmailSenderTriggerEvent,
): Promise<CustomEmailSenderTriggerEvent> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));

  if (event.triggerSource === 'CustomEmailSender_AdminCreateUser') {
    const email: string = event.request.userAttributes.email;
    const userId: string = event.request.userAttributes.sub;
    const temporaryPassword: string = event.request.code || ''; // Auto encrypted by Cognito
    const organizationId: string = event.request.clientMetadata ? event.request.clientMetadata.OrganizationId : '';
    const organizationName: string = event.request.clientMetadata ? event.request.clientMetadata.OrganizationName : '';

    const newUserInvitationJwt: string = generateNewUserInvitationJwt(email, userId, organizationId, temporaryPassword);
    await sesService.sendNewUserInvitationEmail(email, organizationName, newUserInvitationJwt);
  } else if (event.triggerSource === 'CustomEmailSender_ForgotPassword') {
    const email: string = event.request.userAttributes.email;
    const userId: string = event.request.userAttributes.sub;
    const code: string = event.request.code || ''; // Auto encrypted by Cognito

    const forgotPasswordJwt: string = generateUserForgotPasswordJwt(email, userId, code);
    await sesService.sendUserForgotPasswordEmail(email, forgotPasswordJwt);
  }

  return event;
};

/**
 * Helper function to generate a new User Invitation JWT to send in an
 * invitation email and used to verify User Invitation acceptance.
 *
 * The JWT is set to expire in 1 day to match Cognito's AdminCreateUser
 * confirmation expiry.
 * @param email
 * @param userId
 * @param organizationId
 */
function generateNewUserInvitationJwt(
  email: string,
  userId: string,
  organizationId: string,
  temporaryPassword: string,
): string {
  const createdAt: number = Date.now(); // Salt
  const userInvitationJwt: UserInvitationJwt = {
    RequestType: 'NewUserInvitation',
    Verification: createHmac('sha256', process.env.JWT_SECRET_KEY + createdAt)
      .update(userId + organizationId)
      .digest('hex'),
    Email: email,
    OrganizationId: organizationId,
    TemporaryPassword: temporaryPassword, // Encrypted
    CreatedAt: createdAt,
  };
  return generateJwt(userInvitationJwt, process.env.JWT_SECRET_KEY, '7 d');
}

/**
 * Helper function to generate User Forgot Password JWT to send in email
 * and used to verify User Forgot Password request.
 *
 * The JWT is set to expire in 1 hour to match Cognito's ForgotPassword
 * confirmation expiry.
 * @param email
 * @param username
 * @param code
 */
function generateUserForgotPasswordJwt(email: string, username: string, code: string): string {
  const createdAt: number = Date.now(); // Salt
  const userForgotPasswordJwt: UserForgotPasswordJwt = {
    RequestType: 'UserForgotPassword',
    Verification: createHmac('sha256', process.env.JWT_SECRET_KEY + createdAt)
      .update(username + code)
      .digest('hex'),
    Email: email,
    Code: code, // Encrypted
    CreatedAt: createdAt,
  };
  return generateJwt(userForgotPasswordJwt, process.env.JWT_SECRET_KEY, '1 h');
}
