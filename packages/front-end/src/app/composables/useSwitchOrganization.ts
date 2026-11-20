/**
 * Switches the user's active organization (DefaultOrganization + JWT claims).
 * Every org switch goes through here so labs and other org-scoped views use the correct context.
 */
export default function useSwitchOrganization() {
  async function switchTo(orgId: string, options?: { showToast?: boolean }): Promise<void> {
    const userStore = useUserStore();
    const uiStore = useUiStore();
    const { $api } = useNuxtApp();

    if (userStore.currentOrgId === orgId) {
      userStore.mostRecentLab.LaboratoryId = null;
      return;
    }

    uiStore.setRequestPending('switchOrg');

    try {
      await $api.users.updateUserLastAccessInfo(userStore.currentUserDetails.id!, orgId, undefined);

      await useAuth().getRefreshedToken();
      // Cleared only once the switch can't fail any more, so a failed switch keeps your lab; it must
      // still happen before the token is read, which fills it from DefaultLaboratory only when empty.
      userStore.mostRecentLab.LaboratoryId = null;
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
