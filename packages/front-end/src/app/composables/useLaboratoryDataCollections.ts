import type {
  LaboratorySequenceCollection,
  LaboratorySample,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
import { useUiStore } from '@FE/stores';
import type { ExplorerSelection } from '@FE/utils/data-collections-selection';
import {
  selectedFileKeys,
  selectedSampleIds,
  selectionHasOnlyFiles,
  selectionHasOnlySamples,
} from '@FE/utils/data-collections-selection';

export function useLaboratoryDataCollections(labId: Ref<string> | ComputedRef<string>) {
  const { $api } = useNuxtApp();
  const uiStore = useUiStore();

  const samples = ref<LaboratorySample[]>([]);
  const sequenceCollections = ref<LaboratorySequenceCollection[]>([]);
  const keyToSampleIds = ref<Record<string, string[]>>({});
  /** Sample ids belonging to the sequence collection selected in the left rail (when filtering). */
  const sequenceCollectionMemberSampleIds = ref<Set<string>>(new Set());

  const sampleFilterIds = ref<string[]>([]);
  const sequenceCollectionFilterId = ref<string | undefined>(undefined);

  const samplesSectionExpanded = ref(true);
  const sequenceCollectionsSectionExpanded = ref(true);
  const showAllSamples = ref(false);

  const loadingSamples = computed(() => uiStore.isRequestPending('dataCollectionsSamples'));
  const loadingSequenceCollections = computed(() => uiStore.isRequestPending('dataCollectionsRunSequenceCollections'));

  const sampleById = computed(() => {
    const map: Record<string, LaboratorySample> = {};
    for (const s of samples.value) map[s.SampleId] = s;
    return map;
  });

  const sequenceCollectionById = computed(() => {
    const map: Record<string, LaboratorySequenceCollection> = {};
    for (const c of sequenceCollections.value) {
      if (c?.SequenceCollectionId) map[c.SequenceCollectionId] = c;
    }
    return map;
  });

  async function fetchSamples(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsSamples');
    try {
      const res = await $api.dataCollections.listSamples(unref(labId));
      samples.value = res.Samples;
    } finally {
      uiStore.setRequestComplete('dataCollectionsSamples');
    }
  }

  async function fetchSequenceCollections(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunSequenceCollections');
    try {
      const res = await $api.dataCollections.listSequenceCollections(unref(labId));
      sequenceCollections.value = res.SequenceCollections ?? [];
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunSequenceCollections');
    }
  }

  async function refreshGroupingMetadata(): Promise<void> {
    await Promise.all([fetchSamples(), fetchSequenceCollections()]);
  }

  function applyFileSampleIds(files: { Key: string; SampleIds?: string[] }[]): void {
    const next: Record<string, string[]> = {};
    for (const f of files) {
      if (f.SampleIds?.length) next[f.Key] = f.SampleIds;
    }
    keyToSampleIds.value = next;
  }

  async function loadSequenceCollectionMemberSampleIds(collectionId: string | undefined): Promise<void> {
    if (!collectionId) {
      sequenceCollectionMemberSampleIds.value = new Set();
      return;
    }
    uiStore.setRequestPending('dataCollectionsRunSequenceCollections');
    try {
      const res = await $api.dataCollections.listSequenceCollectionSamples(unref(labId), collectionId);
      sequenceCollectionMemberSampleIds.value = new Set(res.SampleIds);
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunSequenceCollections');
    }
  }

  watch(sequenceCollectionFilterId, async (id) => {
    await loadSequenceCollectionMemberSampleIds(id);
  });

  function fileMatchesSampleFilters(key: string): boolean {
    if (!sampleFilterIds.value.length && !sequenceCollectionFilterId.value) return true;
    const setIds = keyToSampleIds.value[key] || [];
    if (sampleFilterIds.value.length) {
      const matchesAny = sampleFilterIds.value.some((id) => setIds.includes(id));
      if (!matchesAny) return false;
    }
    if (sequenceCollectionFilterId.value) {
      const matchesSc = setIds.some((id) => sequenceCollectionMemberSampleIds.value.has(id));
      if (!matchesSc) return false;
    }
    return true;
  }

  function sampleMatchesFilters(setId: string): boolean {
    if (sampleFilterIds.value.length && !sampleFilterIds.value.includes(setId)) return false;
    if (sequenceCollectionFilterId.value && !sequenceCollectionMemberSampleIds.value.has(setId)) return false;
    return true;
  }

  function canAddToSample(selection: ExplorerSelection): boolean {
    return selectionHasOnlyFiles(selection);
  }

  function canAddToSequenceCollection(selection: ExplorerSelection): boolean {
    return selectionHasOnlySamples(selection);
  }

  function addToSampleDisabledReason(selection: ExplorerSelection): string | undefined {
    if (!selection.length) return 'Select one or more files';
    if (!selectionHasOnlyFiles(selection)) return 'Deselect samples to add files to a sample';
    return undefined;
  }

  function addToSequenceCollectionDisabledReason(selection: ExplorerSelection): string | undefined {
    if (!selection.length) return 'Select one or more samples';
    if (!selectionHasOnlySamples(selection)) return 'Deselect files to add samples to a sequence collection';
    return undefined;
  }

  return {
    samples,
    sequenceCollections,
    keyToSampleIds,
    sampleFilterIds,
    sequenceCollectionFilterId,
    samplesSectionExpanded,
    sequenceCollectionsSectionExpanded,
    showAllSamples,
    loadingSamples,
    loadingSequenceCollections,
    sampleById,
    sequenceCollectionById,
    fetchSamples,
    fetchSequenceCollections,
    refreshGroupingMetadata,
    applyFileSampleIds,
    fileMatchesSampleFilters,
    sampleMatchesFilters,
    canAddToSample,
    canAddToSequenceCollection,
    addToSampleDisabledReason,
    addToSequenceCollectionDisabledReason,
    selectedFileKeys,
    selectedSampleIds,
  };
}
