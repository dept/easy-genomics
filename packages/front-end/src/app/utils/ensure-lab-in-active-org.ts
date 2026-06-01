import { storeToRefs } from 'pinia';
import { useToastStore } from '@FE/stores';

export type EnsureLabInActiveOrgOptions = {
  labId: string;
  redirectTo?: string;
  /** When true, bypasses the org check (e.g. admin EGLabView route). */
  superuser?: boolean;
};

/**
 * Ensures a lab route cannot render a lab belonging to a different org than the active org.
 * The active org controls the browsing context even when the user has access to multiple orgs.
 *
 * Always loads fresh lab data before validating to avoid false redirects from persisted store state.
 *
 * @returns true if navigation away was initiated (caller should stop further work).
 */
export async function ensureLabInActiveOrg({
  labId,
  redirectTo = '/labs',
  superuser = false,
}: EnsureLabInActiveOrgOptions): Promise<boolean> {
  const userStore = useUserStore();
  const labsStore = useLabsStore();
  const { currentOrgId } = storeToRefs(userStore);

  if (superuser || userStore.isSuperuser) {
    return false;
  }

  try {
    await labsStore.loadLab(labId);
  } catch (error) {
    console.error('Failed to load laboratory for org validation', error);
    useToastStore().error('Failed to load laboratory');
    await navigateTo(redirectTo);
    return true;
  }

  const lab = labsStore.labs[labId];
  if (!lab) {
    console.error('Laboratory not found after load', { labId });
    useToastStore().error('Failed to load laboratory');
    await navigateTo(redirectTo);
    return true;
  }

  const labOrgId = lab.OrganizationId ?? null;
  if (!!currentOrgId.value && !!labOrgId && currentOrgId.value !== labOrgId) {
    await navigateTo(redirectTo);
    return true;
  }

  return false;
}
