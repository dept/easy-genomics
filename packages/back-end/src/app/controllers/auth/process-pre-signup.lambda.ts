import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { PreSignUpTriggerEvent, Handler } from 'aws-lambda';
import { UserService } from '../../services/easy-genomics/user-service';

const userService = new UserService();

/**
 * This auth lambda function is triggered by the Cognito Pre-Sign-Up Event:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html
 *
 * It prevents automatic user creation for Google sign-in by:
 * - Checking if the user is registered in the system for external providers (Google)
 * - Rejecting unregistered users with a custom error message
 * - Allowing normal sign-up flow for standard Cognito authentication
 *
 * @param event
 */
export const handler: Handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  // Only enforce registration check for external providers (Google, etc.)
  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    const email = event.request.userAttributes.email;

    // Check if user is registered in the system
    const isRegistered: User | undefined = (await userService.queryByEmail(email).catch(() => null))?.shift();

    if (!isRegistered) {
      throw new Error('User is not registered. Please contact your administrator to create an account.');
    }

    // Auto-confirm and auto-verify email for registered external users
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  // For standard sign-up (PreSignUp_SignUp), allow default Cognito behavior
  // The user will need to verify their email through the normal flow

  return event;
};
