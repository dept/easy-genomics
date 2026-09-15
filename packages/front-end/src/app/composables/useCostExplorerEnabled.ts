/**
 * Runtime flag for optional AWS Cost Explorer billed-cost sync.
 * Prefer this over duplicating the runtime-config check in components.
 */
export function useCostExplorerEnabled() {
  return computed(
    () => (useRuntimeConfig().public as { COST_EXPLORER_ENABLED?: boolean }).COST_EXPLORER_ENABLED === true,
  );
}
