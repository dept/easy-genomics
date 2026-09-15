import {
  WORKFLOW_RUN_PRESET_LIMIT,
  type WorkflowRunPreset,
  type WorkflowRunPresetParams,
  type WorkflowRunPresetScope,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import { defineStore } from 'pinia';

/**
 * Saved AWS HealthOmics run parameter presets for one laboratory + workflow pair.
 *
 * Presets are always reloaded from the API when the run form opens, so nothing here is
 * persisted — a stale cached preset would silently launch a run with the wrong parameters.
 */
interface WorkflowRunPresetsStoreState {
  /** Keyed by `${laboratoryId}/${workflowId}`. */
  presetsByWorkflow: Record<string, WorkflowRunPreset[]>;
}

const initialState = (): WorkflowRunPresetsStoreState => ({
  presetsByWorkflow: {},
});

function cacheKey(laboratoryId: string, workflowId: string): string {
  return `${laboratoryId}/${workflowId}`;
}

/** Surfaces the API's typed error message (cap reached, name taken, …) rather than a generic one. */
function toastFailure(error: unknown, fallback: string): void {
  console.error(fallback, error);
  useToastStore().error(error instanceof Error && error.message ? error.message : fallback);
}

const useWorkflowRunPresetsStore = defineStore('workflowRunPresetsStore', {
  state: initialState,

  getters: {
    presetsFor:
      (state: WorkflowRunPresetsStoreState) =>
      (laboratoryId: string, workflowId: string): WorkflowRunPreset[] =>
        state.presetsByWorkflow[cacheKey(laboratoryId, workflowId)] ?? [],

    /** False once the owner holds the maximum presets allowed for this tier. */
    canCreatePreset:
      (state: WorkflowRunPresetsStoreState) =>
      (laboratoryId: string, workflowId: string, scope: WorkflowRunPresetScope): boolean =>
        (state.presetsByWorkflow[cacheKey(laboratoryId, workflowId)] ?? []).filter((preset) => preset.Scope === scope)
          .length < WORKFLOW_RUN_PRESET_LIMIT,
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    async loadPresets(laboratoryId: string, workflowId: string): Promise<void> {
      const { $api } = useNuxtApp();
      const uiStore = useUiStore();

      uiStore.setRequestPending('loadWorkflowRunPresets');
      try {
        const res = await $api.workflowRunPresets.list(laboratoryId, workflowId);
        this.presetsByWorkflow[cacheKey(laboratoryId, workflowId)] = [...res.LabPresets, ...res.UserPresets];
      } catch (error: unknown) {
        toastFailure(error, 'Unable to load saved parameter presets.');
      } finally {
        uiStore.setRequestComplete('loadWorkflowRunPresets');
      }
    },

    /** Returns the created preset, or null when the request failed. */
    async createPreset(
      laboratoryId: string,
      workflowId: string,
      scope: WorkflowRunPresetScope,
      name: string,
      params: WorkflowRunPresetParams,
    ): Promise<WorkflowRunPreset | null> {
      const { $api } = useNuxtApp();
      const uiStore = useUiStore();

      uiStore.setRequestPending('saveWorkflowRunPreset');
      try {
        const preset = await $api.workflowRunPresets.create({
          LaboratoryId: laboratoryId,
          WorkflowId: workflowId,
          Scope: scope,
          Name: name,
          Params: params,
        });
        await this.loadPresets(laboratoryId, workflowId);
        return preset;
      } catch (error: unknown) {
        toastFailure(error, 'Unable to save preset.');
        return null;
      } finally {
        uiStore.setRequestComplete('saveWorkflowRunPreset');
      }
    },

    async updatePreset(
      preset: WorkflowRunPreset,
      changes: { Name?: string; Params?: WorkflowRunPresetParams },
    ): Promise<WorkflowRunPreset | null> {
      const { $api } = useNuxtApp();
      const uiStore = useUiStore();

      uiStore.setRequestPending('saveWorkflowRunPreset');
      try {
        const updated = await $api.workflowRunPresets.update(preset.PresetId, {
          LaboratoryId: preset.LaboratoryId,
          WorkflowId: preset.WorkflowId,
          Scope: preset.Scope,
          ...changes,
        });
        await this.loadPresets(preset.LaboratoryId, preset.WorkflowId);
        return updated;
      } catch (error: unknown) {
        toastFailure(error, 'Unable to update preset.');
        return null;
      } finally {
        uiStore.setRequestComplete('saveWorkflowRunPreset');
      }
    },

    /**
     * Promotes the user's legacy `OmicsWorkflowDefaultParams` entry for this workflow into a
     * named personal preset, then clears the legacy entry.
     *
     * This lets the old single-slot field drain away as users opt in, so no server-side data
     * migration is needed. The legacy entry is only cleared once the preset write succeeded.
     */
    async adoptLegacyDefaults(
      laboratoryId: string,
      workflowId: string,
      params: WorkflowRunPresetParams,
    ): Promise<WorkflowRunPreset | null> {
      const { $api } = useNuxtApp();
      const userStore = useUserStore();

      const userId = userStore.currentUserDetails.id;
      if (!userId) {
        useToastStore().error('Unable to save preset: no signed-in user.');
        return null;
      }

      const created = await this.createPreset(laboratoryId, workflowId, 'USER', 'My saved defaults', params);
      if (!created) return null;

      const uiStore = useUiStore();
      uiStore.setRequestPending('saveWorkflowRunPreset');
      try {
        const user = await $api.users.getUser();
        const remaining = Object.fromEntries(
          Object.entries(user.OmicsWorkflowDefaultParams ?? {}).filter(([key]) => key !== workflowId),
        );
        await $api.users.updateUser(userId, { OmicsWorkflowDefaultParams: remaining });
      } catch (error: unknown) {
        // The preset exists, so the user has lost nothing; the legacy defaults simply remain
        // in place and the prompt to adopt them will reappear on the next visit.
        toastFailure(error, 'Preset saved, but the older defaults could not be cleared.');
      } finally {
        uiStore.setRequestComplete('saveWorkflowRunPreset');
      }

      return created;
    },

    async deletePreset(preset: WorkflowRunPreset): Promise<boolean> {
      const { $api } = useNuxtApp();
      const uiStore = useUiStore();

      uiStore.setRequestPending('saveWorkflowRunPreset');
      try {
        await $api.workflowRunPresets.delete(preset.PresetId, preset.LaboratoryId, preset.WorkflowId, preset.Scope);
        await this.loadPresets(preset.LaboratoryId, preset.WorkflowId);
        return true;
      } catch (error: unknown) {
        toastFailure(error, 'Unable to delete preset.');
        return false;
      } finally {
        uiStore.setRequestComplete('saveWorkflowRunPreset');
      }
    },
  },
});

export default useWorkflowRunPresetsStore;
