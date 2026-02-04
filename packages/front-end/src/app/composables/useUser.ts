import { CreateUserInvitationRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-invitation';
import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
import { OrganizationAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { CreateUserInvitationRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import { VALIDATION_MESSAGES } from '@FE/constants/validation';
import { useToastStore } from '@FE/stores';
import { decodeJwt } from '@FE/utils/jwt-utils';

export type NameOptions = {
  firstName: string | null;
  preferredName: string | null;
  lastName: string | null;
  email: string | null;
};

/**
 * Composables for any User related functionality
 */
export default function useUser() {
  /**
   * Returns the display name of a user
   */
  function displayName(nameOptions: NameOptions): string {
    const { firstName, preferredName, lastName, email } = nameOptions;
    const preferredOrFirstName = preferredName || firstName;

    if (preferredOrFirstName && lastName) return `${preferredOrFirstName} ${lastName}`;
    if (preferredOrFirstName) return preferredOrFirstName;
    if (lastName) return lastName;
    if (email) return email;
    return '???';
  }

  /**
   * Returns the display initials of a user
   */
  function initials(nameOptions: NameOptions, superuser: boolean = false): string {
    if (superuser) {
      return '#';
    }

    const { preferredName, firstName, lastName, email } = nameOptions;
    const preferredOrFirstName = preferredName || firstName;

    const firstInitial = preferredOrFirstName?.charAt(0);
    const lastInitial = lastName?.charAt(0);
    const emailInitial = email?.charAt(0);

    if (firstInitial && lastInitial) return firstInitial + lastInitial;
    if (firstInitial) return firstInitial;
    if (lastInitial) return lastInitial;
    if (emailInitial) return emailInitial;
    return '??';
  }

  async function handleInvite(reqBody: CreateUserInvitationRequest, action: 'resend' | 'send') {
    const { $api } = useNuxtApp();
    const result = CreateUserInvitationRequestSchema.safeParse(reqBody);
    if (!result.success) {
      console.error('Zod validation failed', result.error);
      return;
    }

    const { OrganizationId: orgId, Email: email } = result.data;
    const toastSuccessMessage =
      action === 'send' ? `${email} has been sent an invite` : `${email} has been resent an invite`;
    const toastErrorMessage = VALIDATION_MESSAGES.network;

    try {
      await $api.users.invite(orgId, email);
      useToastStore().success(toastSuccessMessage);
    } catch (error) {
      useToastStore().error(toastErrorMessage);
      console.error(error);
    }
  }

  async function resendInvite(user: { OrganizationId: string; UserEmail: string }) {
    const { OrganizationId: orgId, UserEmail: email } = user;
    await handleInvite(
      {
        OrganizationId: orgId,
        Email: email,
      },
      'resend',
    );
  }

  async function invite(reqBody: CreateUserInvitationRequest) {
    await handleInvite(reqBody, 'send');
  }

  /**
   * Count the number of labs a user has access to; default to 0 if no access
   * @param user
   */
  function labsCount(user: OrganizationUserDetails) {
    const labsAccess = Object.values(user?.OrganizationAccess || {}).flatMap((orgAccess) =>
      Object.values(orgAccess?.LaboratoryAccess || {}),
    );
    return labsAccess.filter((labAccess) => labAccess.Status === 'Active').length;
  }

  /**
   * @description Obtains details about the current user from the auth JWT then sets them in the user store
   */
  async function setCurrentUserDataFromToken() {
    try {
      const userStore = useUserStore();

      // decode token
      const token = await useAuth().getToken();
      const decodedToken: any = decodeJwt(token);

      // retrieve and set account id and email
      userStore.currentUserDetails.id = decodedToken['cognito:username'];
      userStore.currentUserDetails.email = decodedToken.email;

      // check and set superuser status
      userStore.currentUserPermissions.isSuperuser = decodedToken['cognito:groups']?.includes('SystemAdmin');

      // if superuser, quit now, as su accounts won't have any of the details retrieved in the rest of this function
      if (userStore.currentUserPermissions.isSuperuser) {
        return;
      }

      // retrieve and set current org id and org access
      let parsedOrgAccess: OrganizationAccess = {};
      try {
        parsedOrgAccess = JSON.parse(decodedToken.OrganizationAccess) as OrganizationAccess;
      } catch (parseError) {
        console.warn('Failed to parse OrganizationAccess, using empty object:', parseError);
      }
      userStore.currentUserPermissions.orgPermissions = parsedOrgAccess;

      // set default org, or if no value use first org
      userStore.currentOrg.OrganizationId = decodedToken.DefaultOrganization
        ? decodedToken.DefaultOrganization
        : Object.keys(parsedOrgAccess)[0];

      // set most recent lab from default lab value
      // this function gets called on every page view so if there's already a value in the store, don't overwrite
      // if this is a fresh sign in, the store will always be empty anyway and it will use the incoming default value
      if (!userStore.mostRecentLab.LaboratoryId && !!decodedToken.DefaultLaboratory) {
        userStore.mostRecentLab.LaboratoryId = decodedToken.DefaultLaboratory;
      }

      // retrieve and set personal details
      userStore.currentUserDetails.firstName = decodedToken.FirstName;
      userStore.currentUserDetails.lastName = decodedToken.LastName;
      userStore.currentUserDetails.preferredName = decodedToken.PreferredName;
    } catch (error) {
      console.error('Error occurred setting the current organization.', error);
      throw error;
    }
  }

  async function updateDefaultLab(labId: string): Promise<void> {
    const { $api } = useNuxtApp();
    const userStore = useUserStore();

    userStore.mostRecentLab.LaboratoryId = labId;

    await $api.users.updateUserLastAccessInfo(
      userStore.currentUserDetails.id!,
      userStore.currentOrg.OrganizationId!,
      userStore.mostRecentLab.LaboratoryId,
    );
  }

  return {
    displayName,
    initials,
    labsCount,
    invite,
    resendInvite,
    setCurrentUserDataFromToken,
    updateDefaultLab,
  };
}
