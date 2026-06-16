import { AnalyticsConsent } from '@easy-genomics/shared-lib/src/app/types/analytics';
import { defineStore } from 'pinia';

interface AnalyticsStoreState {
  /**
   * Device-level consent choice, persisted to localStorage. `unset` means the
   * user has not yet answered the in-app consent banner, so the banner shows.
   * This is the device source of truth; it is synced from / to the user's
   * DynamoDB record so the choice follows them across browsers.
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
  getters: {
    hasGrantedConsent: (state: AnalyticsStoreState): boolean => state.consent === 'granted',
    hasDecidedConsent: (state: AnalyticsStoreState): boolean => state.consent !== 'unset',
  },
  actions: {
    setConsent(consent: AnalyticsConsent) {
      this.consent = consent;
    },
    reset() {
      // Intentionally does NOT reset consent on sign-out: the device-level
      // choice should persist across sessions until the user changes it.
    },
  },
  persist: true,
});

export default useAnalyticsStore;
