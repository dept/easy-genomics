import type { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import type { RunCostsReport } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import { defineStore } from 'pinia';
import { extractApiErrorMessage } from '@FE/utils/api-utils';

/**
 * The organization's Run costs report. Not persisted: it is cost data and is refetched whenever
 * the Run costs tab opens or its period changes.
 */
interface RunCostsStoreState {
  report: RunCostsReport | null;
  query: RunCostsQuery | null;
  loading: boolean;
}

const initialState = (): RunCostsStoreState => ({
  report: null,
  query: null,
  loading: false,
});

/** Only the latest load may write, so a slow response for an old period never replaces a newer one. */
let latestRequestId = 0;

const useRunCostsStore = defineStore('runCostsStore', {
  state: initialState,

  actions: {
    reset() {
      latestRequestId += 1;
      Object.assign(this, initialState());
    },

    /** @returns true when this call's report is now on screen. On error the last good report stays. */
    async load(query: RunCostsQuery): Promise<boolean> {
      const { $api } = useNuxtApp();
      latestRequestId += 1;
      const requestId = latestRequestId;
      this.loading = true;

      try {
        const report = await $api.usage.listRunCosts(query);
        if (requestId !== latestRequestId) {
          return false;
        }
        this.report = report;
        this.query = query;
        return true;
      } catch (error) {
        if (requestId !== latestRequestId) {
          return false;
        }
        console.error('Failed to load run costs:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? "Couldn't load run costs. Please try again.");
        return false;
      } finally {
        if (requestId === latestRequestId) {
          this.loading = false;
        }
      }
    },
  },
});

export default useRunCostsStore;
