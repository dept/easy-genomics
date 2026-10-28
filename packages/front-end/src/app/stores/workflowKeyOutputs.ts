import type {
  ListWorkflowKeyOutputsResponse,
  PreviewWorkflowKeyOutput,
  RunWorkflowKeyOutputsResponse,
  WorkflowKeyOutput,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { defineStore } from 'pinia';

interface WorkflowKeyOutputsStoreState {
  /** Keyed by `${laboratoryId}/${workflowId}`. */
  definitionsByWorkflow: Record<string, ListWorkflowKeyOutputsResponse>;
  /** Keyed by `${laboratoryId}/${runId}`. */
  runMatchesByRun: Record<string, RunWorkflowKeyOutputsResponse>;
}

const initialState = (): WorkflowKeyOutputsStoreState => ({
  definitionsByWorkflow: {},
  runMatchesByRun: {},
});

function cacheKey(laboratoryId: string, workflowId: string): string {
  return `${laboratoryId}/${workflowId}`;
}

function runCacheKey(laboratoryId: string, runId: string): string {
  return `${laboratoryId}/${runId}`;
}

function toastFailure(error: unknown, fallback: string): void {
  console.error(fallback, error);
  useToastStore().error(error instanceof Error && error.message ? error.message : fallback);
}

const useWorkflowKeyOutputsStore = defineStore('workflowKeyOutputsStore', {
  state: initialState,

  getters: {
    definitionFor:
      (state: WorkflowKeyOutputsStoreState) =>
      (laboratoryId: string, workflowId: string): ListWorkflowKeyOutputsResponse | null =>
        state.definitionsByWorkflow[cacheKey(laboratoryId, workflowId)] ?? null,
    matchesFor:
      (state: WorkflowKeyOutputsStoreState) =>
      (laboratoryId: string, runId: string): RunWorkflowKeyOutputsResponse | null =>
        state.runMatchesByRun[runCacheKey(laboratoryId, runId)] ?? null,
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    async load(laboratoryId: string, workflowId: string): Promise<ListWorkflowKeyOutputsResponse | null> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('loadWorkflowKeyOutputs');
      try {
        const definition = await $api.workflowKeyOutputs.list(laboratoryId, workflowId);
        this.definitionsByWorkflow[cacheKey(laboratoryId, workflowId)] = definition;
        return definition;
      } catch (error) {
        toastFailure(error, 'Unable to load key outputs for this workflow.');
        return null;
      } finally {
        useUiStore().setRequestComplete('loadWorkflowKeyOutputs');
      }
    },

    async loadRunMatches(laboratoryId: string, runId: string): Promise<RunWorkflowKeyOutputsResponse | null> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('loadRunWorkflowKeyOutputs');
      try {
        const matches = await $api.workflowKeyOutputs.runMatches({
          LaboratoryId: laboratoryId,
          RunId: runId,
        });
        this.runMatchesByRun[runCacheKey(laboratoryId, runId)] = matches;
        return matches;
      } catch (error) {
        toastFailure(error, 'Unable to load key outputs for this run.');
        return null;
      } finally {
        useUiStore().setRequestComplete('loadRunWorkflowKeyOutputs');
      }
    },

    async save(
      laboratoryId: string,
      workflowId: string,
      keyOutputs: Array<Pick<WorkflowKeyOutput, 'Label' | 'Pattern'> & { KeyOutputId?: string; ExamplePath?: string }>,
      extras?: { WorkflowName?: string; Platform?: string; SourceRunId?: string },
    ): Promise<boolean> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('saveWorkflowKeyOutputs');
      try {
        const saved = await $api.workflowKeyOutputs.edit({
          LaboratoryId: laboratoryId,
          WorkflowId: workflowId,
          WorkflowName: extras?.WorkflowName,
          Platform: extras?.Platform,
          SourceRunId: extras?.SourceRunId,
          KeyOutputs: keyOutputs,
        });
        this.definitionsByWorkflow[cacheKey(laboratoryId, workflowId)] = {
          LaboratoryId: saved.LaboratoryId,
          WorkflowId: saved.WorkflowId,
          WorkflowName: saved.WorkflowName,
          Platform: saved.Platform,
          SourceRunId: saved.SourceRunId,
          KeyOutputs: saved.KeyOutputs,
          Delivery: saved.Delivery,
          CreatedAt: saved.CreatedAt,
          ModifiedAt: saved.ModifiedAt,
        };
        return true;
      } catch (error) {
        toastFailure(error, 'Unable to save key outputs.');
        return false;
      } finally {
        useUiStore().setRequestComplete('saveWorkflowKeyOutputs');
      }
    },

    async saveDelivery(
      laboratoryId: string,
      workflowId: string,
      delivery: { Enabled: boolean; DestinationUri?: string },
    ): Promise<boolean> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('saveWorkflowKeyOutputDelivery');
      try {
        const saved = await $api.workflowKeyOutputs.editDelivery({
          LaboratoryId: laboratoryId,
          WorkflowId: workflowId,
          Enabled: delivery.Enabled,
          DestinationUri: delivery.DestinationUri,
        });
        this.definitionsByWorkflow[cacheKey(laboratoryId, workflowId)] = {
          LaboratoryId: saved.LaboratoryId,
          WorkflowId: saved.WorkflowId,
          WorkflowName: saved.WorkflowName,
          Platform: saved.Platform,
          SourceRunId: saved.SourceRunId,
          KeyOutputs: saved.KeyOutputs,
          Delivery: saved.Delivery,
          CreatedAt: saved.CreatedAt,
          ModifiedAt: saved.ModifiedAt,
        };
        return true;
      } catch (error) {
        toastFailure(error, 'Unable to save key output delivery.');
        return false;
      } finally {
        useUiStore().setRequestComplete('saveWorkflowKeyOutputDelivery');
      }
    },

    async preview(
      laboratoryId: string,
      runId: string,
      request: { ObjectKeys?: string[]; KeyOutputs?: PreviewWorkflowKeyOutput[] },
    ): Promise<PreviewWorkflowKeyOutput[] | null> {
      const { $api } = useNuxtApp();
      try {
        const response = await $api.workflowKeyOutputs.preview({
          LaboratoryId: laboratoryId,
          RunId: runId,
          ObjectKeys: request.ObjectKeys,
          KeyOutputs: request.KeyOutputs?.map((item) => ({
            KeyOutputId: item.KeyOutputId,
            Label: item.Label,
            Pattern: item.Pattern,
            ExamplePath: item.ExamplePath,
          })),
        });
        return response.KeyOutputs;
      } catch (error) {
        toastFailure(error, 'Unable to match files for these key outputs.');
        return null;
      }
    },
  },
});

export default useWorkflowKeyOutputsStore;
