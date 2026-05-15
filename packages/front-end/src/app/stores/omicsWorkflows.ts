// this import triggers a bizarre eslint problem

import { WorkflowListItem as OmicsWorkflow } from '@aws-sdk/client-omics';
import { defineStore } from 'pinia';

interface OmicsWorkflowsStoreState {
  // indexed by workflow id
  workflows: Record<string, OmicsWorkflow>;
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
      (labId: string): OmicsWorkflow[] =>
        state.workflowIdsByLab[labId]?.map((workflowId) => state.workflows[workflowId]) || [],
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    async loadWorkflowsForLab(labId: string): Promise<void> {
      const { $api } = useNuxtApp();

      const res = await $api.omicsWorkflows.list(labId);

      if (!res.items) {
        throw new Error('list omics workflows response did not contain data');
      }

      this.workflowIdsByLab[labId] = [];

      for (const workflow of res.items) {
        this.workflows[workflow.id!] = workflow;
        this.workflowIdsByLab[labId].push(workflow.id!);
      }
    },
  },

  persist: true,
});

export default useOmicsWorkflowsStore;
