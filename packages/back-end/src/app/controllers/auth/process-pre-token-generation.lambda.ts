import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { Handler } from 'aws-lambda';
import { PreTokenGenerationTriggerEvent } from 'aws-lambda/trigger/cognito-user-pool-trigger/pre-token-generation';
import { LaboratoryUserService } from '../../services/easy-genomics/laboratory-user-service';
import { OrganizationUserService } from '../../services/easy-genomics/organization-user-service';
import { UserService } from '../../services/easy-genomics/user-service';
import { buildOrganizationAccessFromMemberships } from '../../utils/organization-access-builder';

const userService = new UserService();
const organizationUserService = new OrganizationUserService();
const laboratoryUserService = new LaboratoryUserService();

/**
 * This auth lambda function is triggered by the Cognito Pre-Token Generation Event:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
 *
 * @param event
 */
export const handler: Handler = async (
  event: PreTokenGenerationTriggerEvent,
): Promise<PreTokenGenerationTriggerEvent> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));

  // System Admin Account only exists within Cognito User Pool
  if (process.env.SYSTEM_ADMIN_EMAIL === event.request.userAttributes.email) {
    return event;
  }

  const user: User | undefined = (await userService.queryByEmail(event.request.userAttributes.email)).shift();
  if (user) {
    const [organizationUsers, laboratoryUsers] = await Promise.all([
      organizationUserService.queryByUserId(user.UserId),
      laboratoryUserService.queryByUserId(user.UserId),
    ]);
    const organizationAccess = buildOrganizationAccessFromMemberships(organizationUsers, laboratoryUsers);

    event.response = {
      claimsOverrideDetails: {
        claimsToAddOrOverride: {
          ['UserId']: user.UserId,
          ['PreferredName']: user.PreferredName || '',
          ['FirstName']: user.FirstName || '',
          ['LastName']: user.LastName || '',
          ['Status']: user.Status,
          ['DefaultOrganization']: user.DefaultOrganization || '', // User last accessed Organization
          ['DefaultLaboratory']: user.DefaultLaboratory || '', // User last accessed Laboratory
          ['OrganizationAccess']: JSON.stringify(organizationAccess),
          ['SampleIdSplitPattern']: user.SampleIdSplitPattern || '',
        },
      },
    };
  }

  return event;
};
