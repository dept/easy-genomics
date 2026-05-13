import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { CognitoIdpService } from '@BE/services/cognito-idp-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { SesService } from '@BE/services/ses-service';

const cognitoIdpService = new CognitoIdpService({ userPoolId: process.env.COGNITO_USER_POOL_ID });
const organizationUserService = new OrganizationUserService();
const platformUserService = new PlatformUserService();
const sesService = new SesService({
  accountId: process.env.ACCOUNT_ID,
  region: process.env.REGION,
  domainName: process.env.DOMAIN_NAME,
  envType: process.env.ENV_TYPE,
  envName: process.env.ENV_NAME,
});

export class UserInviteService {
  /**
   * Helper function to create new User account and trigger invitation email to the Platform and specified Organization.
   *
   * @param organization
   * @param email
   * @param createdBy
   */
  async inviteNewUserToOrganization(organization: Organization, email: string, createdBy: string) {
    // Attempt to create new Cognito User account - will trigger Cognito process-custom-email-sender to send SES email template
    const userId: string = await cognitoIdpService.adminCreateUser(
      email.toLowerCase(),
      organization.OrganizationId,
      organization.Name,
    );

    // Attempt to add the new User record, and add the Organization-User access mapping in one transaction
    await platformUserService.addNewUserToOrganization(
      {
        UserId: userId,
        Email: email.toLowerCase(),
        Status: 'Invited',
        CreatedAt: new Date().toISOString(),
        CreatedBy: createdBy,
      },
      {
        OrganizationId: organization.OrganizationId,
        UserId: userId,
        Status: 'Invited',
        OrganizationAdmin: false,
        CreatedAt: new Date().toISOString(),
        CreatedBy: createdBy,
      },
    );
  }

  /**
   * Helper function to re-invite existing Invited User to the Platform and specified Organization.
   *
   * @param organization
   * @param user
   * @param modifiedBy
   */
  async reinviteExistingUserToOrganization(organization: Organization, user: User, modifiedBy: string) {
    // Try to find existing OrganizationUser record
    const existingOrganizationUser: OrganizationUser | void = await organizationUserService
      .get(organization.OrganizationId, user.UserId)
      .catch(() => {});

    // Attempt to re-trigger Cognito process-custom-email-sender to send SES email template
    await cognitoIdpService.adminCreateUser(user.Email, organization.OrganizationId, organization.Name, true);

    if (!existingOrganizationUser) {
      // Attempt to update the existing User record, and add the Organization-User access mapping in one transaction
      await platformUserService.addExistingUserToOrganization(
        {
          ...user,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: modifiedBy,
        },
        {
          OrganizationId: organization.OrganizationId,
          UserId: user.UserId,
          Status: 'Invited',
          OrganizationAdmin: false,
          CreatedAt: new Date().toISOString(),
          CreatedBy: modifiedBy,
        },
      );
    }
  }

  /**
   * Helper function to add an existing Active User to an Organization and send courtesy notification.
   * Immediately set Organization User access mapping to 'Active' to provide better end-user convenience.
   *
   * @param organization
   * @param user
   * @param modifiedBy
   */
  async addExistingUserToOrganization(organization: Organization, user: User, modifiedBy: string) {
    // Try to find existing OrganizationUser record
    const existingOrganizationUser: OrganizationUser | void = await organizationUserService
      .get(organization.OrganizationId, user.UserId)
      .catch(() => {});

    if (user.Status === 'Active' && existingOrganizationUser && existingOrganizationUser.Status === 'Active') {
      return; // Do nothing
    }

    const organizationUser: OrganizationUser = existingOrganizationUser
      ? {
          ...existingOrganizationUser,
          Status: 'Active',
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: modifiedBy,
        }
      : {
          OrganizationId: organization.OrganizationId,
          UserId: user.UserId,
          Status: 'Active',
          OrganizationAdmin: false,
          CreatedAt: new Date().toISOString(),
          CreatedBy: modifiedBy,
        };

    // Send out courtesy notification email to advise user they have been added to an Organization
    await sesService.sendExistingUserCourtesyEmail(user.Email, organization.Name);

    // Attempt to update the existing User record, and add the Organization-User access mapping in one transaction
    await platformUserService.addExistingUserToOrganization(
      {
        ...user,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: modifiedBy,
      },
      organizationUser,
    );
  }
}
