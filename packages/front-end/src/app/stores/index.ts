import useAnalyticsStore from './analytics';
import useDataCollectionsStore from './dataCollections';
import useFavouriteWorkflowsStore from './favouriteWorkflows';
import useLabsStore from './labs';
import useOmicsWorkflowsStore from './omicsWorkflows';
import useOrgsStore from './orgs';
import useRunStore from './run';
import useRunCostsStore from './runCosts';
import useSeqeraPipelinesStore from './seqeraPipelines';
import useToastStore from './toast';
import useUiStore from './ui';
import useUserStore from './user';
import useWorkflowKeyOutputsStore from './workflowKeyOutputs';
import useWorkflowRunPresetsStore from './workflowRunPresets';

function resetStores() {
  useDataCollectionsStore().reset();
  useFavouriteWorkflowsStore().reset();
  useLabsStore().reset();
  useOrgsStore().reset();
  useRunStore().reset();
  useRunCostsStore().reset();
  useSeqeraPipelinesStore().reset();
  useOmicsWorkflowsStore().reset();
  useUiStore().reset();
  useUserStore().reset();
  useWorkflowRunPresetsStore().reset();
  useWorkflowKeyOutputsStore().reset();
}
export {
  resetStores,
  useAnalyticsStore,
  useDataCollectionsStore,
  useFavouriteWorkflowsStore,
  useOrgsStore,
  useToastStore,
  useUserStore,
  useUiStore,
  useLabsStore,
  useRunStore,
  useRunCostsStore,
  useSeqeraPipelinesStore,
  useOmicsWorkflowsStore,
  useWorkflowRunPresetsStore,
  useWorkflowKeyOutputsStore,
};
