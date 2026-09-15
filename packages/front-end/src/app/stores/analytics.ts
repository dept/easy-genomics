import { AnalyticsConsent } from '@easy-genomics/shared-lib/src/app/types/analytics';
import { defineStore } from 'pinia';

interface AnalyticsStoreState {
  /**
   * Device-level consent choice, persisted to localStorage. `unset` means the
   * user has not yet answered the in-app consent banner, so the banner shows.
   * Cleared on sign-out so the next account on this browser is not opted in by
   * default; re-synced from the JWT on login so a returning user's server-side
   * choice is restored.
   */
  consent: AnalyticsConsent;
}

const initialState = (): AnalyticsStoreState => ({
  consent: 'unset',
});

/**
 * @description Stores the end-user's analytics consent choice on this device.
 */
const useAnalyticsStore = defineStore('analyticsStore', {
  state: initialState,
  actions: {
    setConsent(consent: AnalyticsConsent) {
      this.consent = consent;
    },
    reset() {
      this.consent = 'unset';
    },
  },
  persist: true,
});

export default useAnalyticsStore;
