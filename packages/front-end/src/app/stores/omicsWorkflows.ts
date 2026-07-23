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
      Object.assign(this, initialState());
    },

    async loadWorkflowsForLab(labId: string): Promise<void> {
      const { $api } = useNuxtApp();

      const [privateRes, sharedRes] = await Promise.all([
        $api.omicsWorkflows.list(labId),
        $api.omicsWorkflows.listShared(labId).catch(() => ({ items: [] as LabOmicsWorkflow[] })),
      ]);

      if (!privateRes.items) {
        throw new Error('list omics workflows response did not contain data');
      }

      this.workflowIdsByLab[labId] = [];
      const seen = new Set<string>();

      for (const workflow of privateRes.items) {
        if (!workflow.id || seen.has(workflow.id)) {
          continue;
        }
        seen.add(workflow.id);
        const row: LabOmicsWorkflow = { ...workflow, source: 'PRIVATE' };
        this.workflows[workflow.id] = row;
        this.workflowIdsByLab[labId].push(workflow.id);
      }

      for (const workflow of sharedRes.items ?? []) {
        if (!workflow.id || seen.has(workflow.id)) {
          continue;
        }
        seen.add(workflow.id);
        const row: LabOmicsWorkflow = {
          id: workflow.id,
          name: workflow.name,
          source: 'SHARED',
          ...(workflow.ownerAccountId ? { ownerAccountId: workflow.ownerAccountId } : {}),
        };
        this.workflows[workflow.id] = row;
        this.workflowIdsByLab[labId].push(workflow.id);
      }
    },
  },

  persist: true,
});

export default useOmicsWorkflowsStore;
