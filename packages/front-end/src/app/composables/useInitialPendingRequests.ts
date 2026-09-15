import type { PendingRequest } from '@FE/stores/ui';

/**
 * Mark UI-store requests as pending during setup so the first render is a
 * loading state. Vue paints once before onBeforeMount/onMounted, so setting
 * pending only inside those hooks flashes content, then a skeleton, then content.
 */
export function useInitialPendingRequests(...keys: PendingRequest[]): void {
  const uiStore = useUiStore();
  for (const key of keys) {
    uiStore.setRequestPending(key);
  }
}
