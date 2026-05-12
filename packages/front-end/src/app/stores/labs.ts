import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { defineStore } from 'pinia';

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
        useToastStore().error('Failed to load lab details. Please refresh.');
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
        useToastStore().error('Failed to load labs. Please refresh.');
      }
    },
  },

  persist: true,
});

export default useLabsStore;
