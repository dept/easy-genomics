/**
 * Switches the user's active organization (DefaultOrganization + JWT claims).
 * Must match EGSwitchOrgModal so Labs and other org-scoped views use the correct context.
 */
export default function useSwitchOrganization() {
  async function switchTo(orgId: string, options?: { showToast?: boolean }): Promise<void> {
    const userStore = useUserStore();
    const uiStore = useUiStore();
    const { $api } = useNuxtApp();

    userStore.mostRecentLab.LaboratoryId = null;

    if (userStore.currentOrgId === orgId) {
      return;
    }

    uiStore.setRequestPending('switchOrg');

    try {
      await $api.users.updateUserLastAccessInfo(userStore.currentUserDetails.id!, orgId, undefined);

      await useAuth().getRefreshedToken();
      await useUser().setCurrentUserDataFromToken();

      // Avoid race where the new org opens the previous org's lab (see EG-1096)
      await new Promise((resolve) => setTimeout(resolve, 100));
      uiStore.incrementRemountAppKey();

      if (options?.showToast !== false) {
        useToastStore().success('You have switched organizations');
      }
    } finally {
      uiStore.setRequestComplete('switchOrg');
    }
  }

  return { switchTo };
}
