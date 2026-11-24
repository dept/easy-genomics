import type {
  EstimateRunCostRequest,
  EstimateRunCostResponse,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { deriveRunLimitReview, runLimitErrorMessage } from '@FE/utils/run-limit-review';

/**
 * Loads the review step's cost estimate and limit verdict, and turns a limit error from the estimate call or a launch
 * into the block message. Both review steps share it so they show the same states.
 */
export function useRunLimitReview(labId: string, buildRequest: () => EstimateRunCostRequest) {
  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();

  const costEstimate = ref<EstimateRunCostResponse | null>(null);
  // Starts true so a lab with limits has launch disabled before the estimate request begins.
  const costEstimateLoading = ref(true);
  // The lab copy loaded with the wizard can be older than the limits the server checks against.
  const runLimitsLoading = ref(true);
  const estimateFailed = ref(false);
  const serverBlockMessage = ref<string | null>(null);

  const review = computed(() =>
    deriveRunLimitReview({
      verdict: costEstimate.value?.limitVerdict,
      estimate: costEstimate.value,
      loading: costEstimateLoading.value,
      estimateFailed: estimateFailed.value,
      serverBlockMessage: serverBlockMessage.value,
      runLimits: labsStore.labs[labId]?.RunLimits,
      runLimitsLoading: runLimitsLoading.value,
    }),
  );

  async function reloadRunLimits(): Promise<void> {
    runLimitsLoading.value = true;
    try {
      await labsStore.loadLab(labId);
    } finally {
      runLimitsLoading.value = false;
    }
  }

  async function loadEstimate(): Promise<void> {
    await Promise.all([reloadRunLimits(), fetchEstimate()]);
  }

  async function fetchEstimate(): Promise<void> {
    costEstimateLoading.value = true;
    try {
      costEstimate.value = await $api.labs.estimateRunCost(labId, buildRequest());
    } catch (error) {
      costEstimate.value = null;
      const limitMessage = runLimitErrorMessage(error);
      if (limitMessage) {
        serverBlockMessage.value = limitMessage;
      } else {
        console.warn('Pre-run cost estimate unavailable:', error);
        estimateFailed.value = true;
      }
    } finally {
      costEstimateLoading.value = false;
    }
  }

  /** True when `error` was a limit block. The block is then shown and toasted, and the caller must not toast again. */
  async function handleLaunchError(error: unknown): Promise<boolean> {
    const limitMessage = runLimitErrorMessage(error);
    if (!limitMessage) {
      return false;
    }
    serverBlockMessage.value = limitMessage;
    useToastStore().error(limitMessage);
    // The lab's limits changed since this page loaded them, so the Samples row would show the old amount.
    await labsStore.loadLab(labId);
    return true;
  }

  return { costEstimate, costEstimateLoading, review, loadEstimate, handleLaunchError };
}
