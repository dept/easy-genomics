import type { UpdateLaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { defineStore } from 'pinia';
import { extractApiErrorMessage } from '@FE/utils/api-utils';

interface LabsStoreState {
  // indexed by labId
  labs: Record<string, Laboratory>;
  // ordered lists for labs by org
  labIdsByOrg: Record<string, string[]>;
}

const initialState = (): LabsStoreState => ({
  labs: {},
  labIdsByOrg: {},
});

async function shouldSuppressLabLoadErrorToast(): Promise<boolean> {
  if (useUiStore().isLoggingOut) {
    return true;
  }
  // No session (logout or expiry) — lab fetch failures are expected.
  return !(await useAuth().isAuthed());
}

const useLabsStore = defineStore('labsStore', {
  state: initialState,

  getters: {
    labsForOrg:
      (state: LabsStoreState) =>
      (orgId: string): Laboratory[] =>
        state.labIdsByOrg[orgId]?.map((labId) => state.labs[labId]) || [],
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    async loadLab(labId: string): Promise<void> {
      const { $api } = useNuxtApp();

      try {
        const lab = await $api.labs.labDetails(labId);
        this.labs[lab.LaboratoryId] = lab;
      } catch (error) {
        console.error('Failed to load lab:', error);
        if (!(await shouldSuppressLabLoadErrorToast())) {
          useToastStore().error('Failed to load lab details. Please refresh.');
        }
      }
    },

    async loadLabsForOrg(orgId: string): Promise<void> {
      const { $api } = useNuxtApp();

      try {
        const labs = await $api.labs.list(orgId);
        this.labIdsByOrg[orgId] = [];

        for (const lab of labs) {
          this.labs[lab.LaboratoryId] = lab;
          this.labIdsByOrg[orgId].push(lab.LaboratoryId);
        }
      } catch (error) {
        console.error('Failed to load labs:', error);
        if (!(await shouldSuppressLabLoadErrorToast())) {
          useToastStore().error('Failed to load labs. Please refresh.');
        }
      }
    },

    /** Stores the lab the server returns; a failed save leaves the stored lab untouched. */
    async updateRunLimits(labId: string, runLimits: UpdateLaboratoryRunLimits): Promise<boolean> {
      const { $api } = useNuxtApp();

      try {
        const lab = await $api.labs.updateRunLimits(labId, runLimits);
        this.labs[lab.LaboratoryId] = lab;
        return true;
      } catch (error) {
        console.error('Failed to save lab run limits:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to save usage limits. Please try again.');
        return false;
      }
    },
  },

  persist: true,
});

export default useLabsStore;
