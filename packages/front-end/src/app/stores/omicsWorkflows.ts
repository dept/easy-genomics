// this import triggers a bizarre eslint problem

import type { ListWorkflows } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import { defineStore } from 'pinia';

type OmicsWorkflow = NonNullable<ListWorkflows['items']>[number];

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
        throw new Error('list seqera pipelines response did not contain data');
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
