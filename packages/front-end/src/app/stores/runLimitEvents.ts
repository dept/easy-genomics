import type { RunLimitEventsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-limit-events';
import type { RunLimitEventsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import { defineStore } from 'pinia';
import { extractApiErrorMessage } from '@FE/utils/api-utils';

/**
 * The warned or blocked launches behind a Run costs card. Not persisted: it names users and is
 * refetched whenever the slide-over opens.
 */
interface RunLimitEventsStoreState {
  response: RunLimitEventsResponse | null;
  query: RunLimitEventsQuery | null;
  /** The latest load's query when it failed, so the panel shows an error rather than an empty list. */
  failedQuery: RunLimitEventsQuery | null;
  loading: boolean;
}

const initialState = (): RunLimitEventsStoreState => ({
  response: null,
  query: null,
  failedQuery: null,
  loading: false,
});

/** Only the latest load may write, so a slow response for an old query never replaces a newer one. */
let latestRequestId = 0;

const useRunLimitEventsStore = defineStore('runLimitEventsStore', {
  state: initialState,

  actions: {
    reset() {
      latestRequestId += 1;
      Object.assign(this, initialState());
    },

    /** @returns true when this call's response is now on screen. On error the last good response stays. */
    async load(query: RunLimitEventsQuery): Promise<boolean> {
      const { $api } = useNuxtApp();
      latestRequestId += 1;
      const requestId = latestRequestId;
      this.loading = true;

      try {
        const response = await $api.usage.listRunLimitEvents(query);
        if (requestId !== latestRequestId) {
          return false;
        }
        this.response = response;
        this.query = query;
        this.failedQuery = null;
        return true;
      } catch (error) {
        if (requestId !== latestRequestId) {
          return false;
        }
        this.failedQuery = query;
        console.error('Failed to load run limit events:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? "Couldn't load the launches. Please try again.");
        return false;
      } finally {
        if (requestId === latestRequestId) {
          this.loading = false;
        }
      }
    },
  },
});

export default useRunLimitEventsStore;
