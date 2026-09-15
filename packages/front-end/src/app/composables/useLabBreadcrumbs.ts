/**
 * Builds lab-scoped breadcrumb destinations that preserve the current route prefix
 * (e.g. `/labs/:labId` or `/orgs/:orgId/labs/:labId`).
 */
export function useLabBreadcrumbs(labId: MaybeRefOrGetter<string>) {
  const route = useRoute();

  const labBasePath = computed(() => {
    const id = toValue(labId);
    const match = route.path.match(/^(.*?\/labs\/[^/]+)/);
    return match?.[1] ?? `/labs/${id}`;
  });

  function labPath(subPath = ''): string {
    const suffix = subPath ? (subPath.startsWith('/') ? subPath : `/${subPath}`) : '';
    return `${labBasePath.value}${suffix}`;
  }

  function labTab(tab: string): { path: string; query: { tab: string } } {
    return {
      path: labBasePath.value,
      query: { tab },
    };
  }

  /** String form for `$router.push` / navigation-guard `nextRoute` assignments. */
  function labTabHref(tab: string): string {
    return `${labBasePath.value}?tab=${encodeURIComponent(tab)}`;
  }

  return {
    labBasePath,
    labPath,
    labTab,
    labTabHref,
  };
}
