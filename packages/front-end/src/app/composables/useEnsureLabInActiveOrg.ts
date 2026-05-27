import { storeToRefs } from 'pinia';

/**
 * Ensures a lab route cannot render a lab belonging to a different org than the active org.
 * This intentionally applies even if the user has permissions in multiple orgs: the active org
 * controls the browsing context.
 */
export async function useEnsureLabInActiveOrg(labId: string, redirectTo: string = '/labs'): Promise<void> {
  const userStore = useUserStore();
  const labsStore = useLabsStore();

  if (userStore.isSuperuser) return;

  // Ensure we have the lab record available for org validation.
  if (!labsStore.labs[labId]) {
    try {
      await labsStore.loadLab(labId);
    } catch {
      // If we can't load the lab, fall back to redirecting out of the lab route.
      await navigateTo(redirectTo);
      return;
    }
  }

  const { currentOrgId } = storeToRefs(userStore);
  const lab = labsStore.labs[labId];
  const labOrgId = lab?.OrganizationId ?? null;

  if (!!currentOrgId.value && !!labOrgId && currentOrgId.value !== labOrgId) {
    await navigateTo(redirectTo);
  }
}
