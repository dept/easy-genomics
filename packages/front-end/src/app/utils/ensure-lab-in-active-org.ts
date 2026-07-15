import { storeToRefs } from 'pinia';
import { useToastStore } from '@FE/stores';

export type EnsureLabInActiveOrgOptions = {
  labId: string;
  redirectTo?: string;
  /** When true, bypasses the org check (e.g. admin EGLabView route). */
  superuser?: boolean;
  /**
   * When true, always re-fetches lab details before validating.
   * Default false: reuse the in-memory lab when present so callers watching `lab`
   * are not put into a load→mutate→re-watch loop.
   */
  forceReload?: boolean;
};

/**
 * Ensures a lab route cannot render a lab belonging to a different org than the active org.
 * The active org controls the browsing context even when the user has access to multiple orgs.
 *
 * Loads lab data when missing (or when forceReload is set) before validating.
 *
 * @returns true if navigation away was initiated (caller should stop further work).
 */
export async function ensureLabInActiveOrg({
  labId,
  redirectTo = '/labs',
  superuser = false,
  forceReload = false,
}: EnsureLabInActiveOrgOptions): Promise<boolean> {
  const userStore = useUserStore();
  const labsStore = useLabsStore();
  const { currentOrgId } = storeToRefs(userStore);

  if (superuser || userStore.isSuperuser) {
    return false;
  }

  const shouldLoad = forceReload || !labsStore.labs[labId];
  if (shouldLoad) {
    try {
      await labsStore.loadLab(labId);
    } catch (error) {
      console.error('Failed to load laboratory for org validation', error);
      useToastStore().error('Failed to load laboratory');
      await navigateTo(redirectTo);
      return true;
    }
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
