import type {
  UpdateLaboratoryRunLimits,
  UpdateLaboratoryWorkflowRunLimits,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import {
  Laboratory,
  LaboratoryWorkflowCostRow,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { defineStore } from 'pinia';
import { extractApiErrorMessage } from '@FE/utils/api-utils';

interface LabsStoreState {
  // indexed by labId
  labs: Record<string, Laboratory>;
  // ordered lists for labs by org
  labIdsByOrg: Record<string, string[]>;
  // indexed by labId; filled when a lab is expanded on the Usage limits page
  workflowCostRows: Record<string, LaboratoryWorkflowCostRow[]>;
}

const initialState = (): LabsStoreState => ({
  labs: {},
  labIdsByOrg: {},
  workflowCostRows: {},
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

    /** Resolves false when the load failed; the labs from an earlier load (persisted) are kept. */
    async loadLabsForOrg(orgId: string): Promise<boolean> {
      const { $api } = useNuxtApp();

      try {
        const labs = await $api.labs.list(orgId);
        this.labIdsByOrg[orgId] = [];

        for (const lab of labs) {
          this.labs[lab.LaboratoryId] = lab;
          this.labIdsByOrg[orgId].push(lab.LaboratoryId);
        }
        return true;
      } catch (error) {
        console.error('Failed to load labs:', error);
        if (!(await shouldSuppressLabLoadErrorToast())) {
          useToastStore().error('Failed to load labs. Please refresh.');
        }
        return false;
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

    /** A failed load keeps any rows already stored, so the caller decides what to show. */
    async loadWorkflowCostRows(labId: string): Promise<boolean> {
      const { $api } = useNuxtApp();

      try {
        this.workflowCostRows[labId] = await $api.labs.listWorkflowRunLimits(labId);
        return true;
      } catch (error) {
        console.error('Failed to load lab workflow run limits:', error);
        useToastStore().error("Couldn't load this lab's workflows.");
        return false;
      }
    },

    /** Reloads the lab's workflow rows after a save, since the server returns only the lab. */
    async updateWorkflowRunLimits(labId: string, body: UpdateLaboratoryWorkflowRunLimits): Promise<boolean> {
      const { $api } = useNuxtApp();

      try {
        const lab = await $api.labs.updateWorkflowRunLimits(labId, body);
        this.labs[lab.LaboratoryId] = lab;
      } catch (error) {
        console.error('Failed to save workflow run limits:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to save usage limits. Please try again.');
        return false;
      }

      await this.loadWorkflowCostRows(labId);
      return true;
    },

    /** Dry run of a new retention period: how many runs expire now vs. get a new expiry date. */
    async previewRunRetention(labId: string, months: number): Promise<{ immediate: number; updated: number } | null> {
      const { $api } = useNuxtApp();

      try {
        const result = await $api.labs.applyRunRetentionPolicy(labId, months, { dryRun: true });
        return { immediate: result.RunsExpireImmediately ?? 0, updated: result.RunsExpirationDateUpdated ?? 0 };
      } catch (error) {
        console.error('Failed to preview retention change:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to load retention change preview');
        return null;
      }
    },

    /**
     * Dedicated retention update — only the three retention fields. Re-applies the run policy
     * when the period changed.
     */
    async updateRetention(
      labId: string,
      retention: Pick<Laboratory, 'RunRetentionMonths' | 'RetentionKeepInputData' | 'RetentionIncludePrePolicyData'>,
    ): Promise<boolean> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('updateLab');

      try {
        const current = this.labs[labId] ?? (await $api.labs.labDetails(labId));
        const lab = await $api.labs.updateRetention(labId, {
          RunRetentionMonths: retention.RunRetentionMonths ?? 6,
          RetentionKeepInputData: retention.RetentionKeepInputData === true,
          RetentionIncludePrePolicyData: retention.RetentionIncludePrePolicyData !== false,
        });
        this.labs[labId] = lab;

        const months = retention.RunRetentionMonths ?? 6;
        if (months !== (current.RunRetentionMonths ?? 6)) {
          try {
            await $api.labs.applyRunRetentionPolicy(labId, months);
          } catch (error) {
            console.error('Failed to apply retention policy:', error);
            useToastStore().error(
              'Retention was saved, but applying it to existing runs failed. Save again or contact support.',
            );
            return false;
          }
        }

        useToastStore().success('Retention saved');
        return true;
      } catch (error) {
        console.error('Failed to save retention:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to save retention. Please try again.');
        return false;
      } finally {
        useUiStore().setRequestComplete('updateLab');
      }
    },
  },

  persist: true,
});

export default useLabsStore;
