/**
 * Opens a page that belongs to an organization, switching the working organization
 * first only when it differs. Previewing another org's labs never switches; this does.
 */
export default function useOrgLabNavigation() {
  async function goInOrg(
    orgId: string,
    path: string,
    arrival?: { labName: string; orgName: string },
  ): Promise<boolean> {
    const isOtherOrg = orgId !== useUserStore().currentOrgId;

    if (isOtherOrg) {
      try {
        await useSwitchOrganization().switchTo(orgId, { showToast: false });
      } catch (error) {
        console.error(`Failed to switch to organization ${orgId}:`, error);
        useToastStore().error("Couldn't switch organization. Please try again.");
        return false;
      }
    }

    await navigateTo(path);

    if (isOtherOrg && arrival) {
      useToastStore().success(`Now working in ${arrival.labName}, ${arrival.orgName}`);
    }
    return true;
  }

  return { goInOrg };
}
