import { WorkflowListItem as OmicsWorkflow } from '@aws-sdk/client-omics';
import { defineStore } from 'pinia';

/** Lab-facing Omics workflow row; SHARED entries include ownerAccountId from ListShares. */
export type LabOmicsWorkflow = OmicsWorkflow & {
  source?: 'PRIVATE' | 'SHARED';
  ownerAccountId?: string;
};

interface OmicsWorkflowsStoreState {
  // indexed by workflow id
  workflows: Record<string, LabOmicsWorkflow>;
  // ordered lists for workflows by lab
  workflowIdsByLab: Record<string, string[]>;
}

const initialState = (): OmicsWorkflowsStoreState => ({
  workflows: {},
  workflowIdsByLab: {},
});

/** Coalesce concurrent loads for the same lab (EGLabView + EGDashboard both call this). */
const loadWorkflowsInflight = new Map<string, Promise<void>>();

const useOmicsWorkflowsStore = defineStore('omicsWorkflowsStore', {
  state: initialState,

  getters: {
    workflowsForLab:
      (state: OmicsWorkflowsStoreState) =>
      (labId: string): LabOmicsWorkflow[] =>
        state.workflowIdsByLab[labId]?.map((workflowId) => state.workflows[workflowId]) || [],
  },

  actions: {
    reset() {
      loadWorkflowsInflight.clear();
      Object.assign(this, initialState());
    },

    async loadWorkflowsForLab(labId: string): Promise<void> {
      const existing = loadWorkflowsInflight.get(labId);
      if (existing) {
        return existing;
      }

      const loadPromise = (async () => {
        const { $api } = useNuxtApp();

        const [privateRes, sharedRes] = await Promise.all([
          $api.omicsWorkflows.list(labId),
          $api.omicsWorkflows.listShared(labId).catch((err) => {
            console.error('Failed to load shared Omics workflows', err);
            useToastStore().error('Failed to load shared workflows. Please refresh.');
            return { items: [] as LabOmicsWorkflow[] };
          }),
        ]);

        if (!privateRes.items) {
          throw new Error('list omics workflows response did not contain data');
        }

        this.workflowIdsByLab[labId] = [];
        const seen = new Set<string>();

        const addWorkflowRow = (workflowId: string, row: LabOmicsWorkflow) => {
          if (seen.has(workflowId)) {
            return;
          }
          seen.add(workflowId);
          this.workflows[workflowId] = row;
          this.workflowIdsByLab[labId].push(workflowId);
        };

        for (const workflow of privateRes.items) {
          if (!workflow.id) {
            continue;
          }
          addWorkflowRow(workflow.id, { ...workflow, source: 'PRIVATE' });
        }

        for (const workflow of sharedRes.items ?? []) {
          if (!workflow.id) {
            continue;
          }
          addWorkflowRow(workflow.id, {
            id: workflow.id,
            name: workflow.name,
            source: 'SHARED',
            ...(workflow.ownerAccountId ? { ownerAccountId: workflow.ownerAccountId } : {}),
          });
        }
      })().finally(() => {
        loadWorkflowsInflight.delete(labId);
      });

      loadWorkflowsInflight.set(labId, loadPromise);
      return loadPromise;
    },
  },

  persist: true,
});

export default useOmicsWorkflowsStore;
