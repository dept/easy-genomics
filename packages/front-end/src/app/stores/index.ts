import useAnalyticsStore from './analytics';
import useDataCollectionsStore from './dataCollections';
import useLabsStore from './labs';
import useOmicsWorkflowsStore from './omicsWorkflows';
import useOrgsStore from './orgs';
import useRunStore from './run';
import useSeqeraPipelinesStore from './seqeraPipelines';
import useToastStore from './toast';
import useUiStore from './ui';
import useUserStore from './user';
import useWorkflowRunPresetsStore from './workflowRunPresets';

function resetStores() {
  useDataCollectionsStore().reset();
  useLabsStore().reset();
  useOrgsStore().reset();
  useRunStore().reset();
  useSeqeraPipelinesStore().reset();
  useOmicsWorkflowsStore().reset();
  useUiStore().reset();
  useUserStore().reset();
  useWorkflowRunPresetsStore().reset();
}
export {
  resetStores,
  useAnalyticsStore,
  useDataCollectionsStore,
  useOrgsStore,
  useToastStore,
  useUserStore,
  useUiStore,
  useLabsStore,
  useRunStore,
  useSeqeraPipelinesStore,
  useOmicsWorkflowsStore,
  useWorkflowRunPresetsStore,
};
