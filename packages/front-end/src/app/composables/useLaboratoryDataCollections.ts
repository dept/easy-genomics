import type {
  LaboratoryRunDataCollection,
  LaboratorySequenceSet,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
import { useUiStore } from '@FE/stores';
import type { ExplorerSelection } from '@FE/utils/data-collections-selection';
import {
  selectedFileKeys,
  selectedSequenceSetIds,
  selectionHasOnlyFiles,
  selectionHasOnlySequenceSets,
} from '@FE/utils/data-collections-selection';

export function useLaboratoryDataCollections(labId: Ref<string> | ComputedRef<string>) {
  const { $api } = useNuxtApp();
  const uiStore = useUiStore();

  const sequenceSets = ref<LaboratorySequenceSet[]>([]);
  const dataCollections = ref<LaboratoryRunDataCollection[]>([]);
  const keyToSequenceSetIds = ref<Record<string, string[]>>({});
  /** Sequence set ids belonging to the data collection selected in the left rail (when filtering). */
  const dataCollectionMemberSetIds = ref<Set<string>>(new Set());

  const sequenceSetsFilterIds = ref<string[]>([]);
  const dataCollectionFilterId = ref<string | undefined>(undefined);

  const sequenceSetsSectionExpanded = ref(true);
  const dataCollectionsSectionExpanded = ref(true);
  const showAllSequenceSets = ref(false);

  const loadingSequenceSets = computed(() => uiStore.isRequestPending('dataCollectionsSequenceSets'));
  const loadingDataCollections = computed(() => uiStore.isRequestPending('dataCollectionsRunCollections'));

  const sequenceSetById = computed(() => {
    const map: Record<string, LaboratorySequenceSet> = {};
    for (const s of sequenceSets.value) map[s.SequenceSetId] = s;
    return map;
  });

  const dataCollectionById = computed(() => {
    const map: Record<string, LaboratoryRunDataCollection> = {};
    for (const c of dataCollections.value) {
      if (c?.DataCollectionId) map[c.DataCollectionId] = c;
    }
    return map;
  });

  async function fetchSequenceSets(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsSequenceSets');
    try {
      const res = await $api.dataCollections.listSequenceSets(unref(labId));
      sequenceSets.value = res.SequenceSets;
    } finally {
      uiStore.setRequestComplete('dataCollectionsSequenceSets');
    }
  }

  async function fetchDataCollections(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunCollections');
    try {
      const res = await $api.dataCollections.listDataCollections(unref(labId));
      dataCollections.value = res.DataCollections ?? [];
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunCollections');
    }
  }

  async function refreshGroupingMetadata(): Promise<void> {
    await Promise.all([fetchSequenceSets(), fetchDataCollections()]);
  }

  function applyFileSequenceSetIds(files: { Key: string; SequenceSetIds?: string[] }[]): void {
    const next: Record<string, string[]> = {};
    for (const f of files) {
      if (f.SequenceSetIds?.length) next[f.Key] = f.SequenceSetIds;
    }
    keyToSequenceSetIds.value = next;
  }

  async function loadDataCollectionMemberSetIds(collectionId: string | undefined): Promise<void> {
    if (!collectionId) {
      dataCollectionMemberSetIds.value = new Set();
      return;
    }
    uiStore.setRequestPending('dataCollectionsRunCollections');
    try {
      const res = await $api.dataCollections.listDataCollectionSequenceSets(unref(labId), collectionId);
      dataCollectionMemberSetIds.value = new Set(res.SequenceSetIds);
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunCollections');
    }
  }

  watch(dataCollectionFilterId, async (id) => {
    await loadDataCollectionMemberSetIds(id);
  });

  function fileMatchesSequenceSetFilters(key: string): boolean {
    if (!sequenceSetsFilterIds.value.length && !dataCollectionFilterId.value) return true;
    const setIds = keyToSequenceSetIds.value[key] || [];
    if (sequenceSetsFilterIds.value.length) {
      const matchesAny = sequenceSetsFilterIds.value.some((id) => setIds.includes(id));
      if (!matchesAny) return false;
    }
    if (dataCollectionFilterId.value) {
      const matchesDc = setIds.some((id) => dataCollectionMemberSetIds.value.has(id));
      if (!matchesDc) return false;
    }
    return true;
  }

  function sequenceSetMatchesFilters(setId: string): boolean {
    if (sequenceSetsFilterIds.value.length && !sequenceSetsFilterIds.value.includes(setId)) return false;
    if (dataCollectionFilterId.value && !dataCollectionMemberSetIds.value.has(setId)) return false;
    return true;
  }

  function canAddToSequenceSet(selection: ExplorerSelection): boolean {
    return selectionHasOnlyFiles(selection);
  }

  function canAddToDataCollection(selection: ExplorerSelection): boolean {
    return selectionHasOnlySequenceSets(selection);
  }

  function addToSequenceSetDisabledReason(selection: ExplorerSelection): string | undefined {
    if (!selection.length) return 'Select one or more files';
    if (!selectionHasOnlyFiles(selection)) return 'Deselect sequence sets to add files to a sequence set';
    return undefined;
  }

  function addToDataCollectionDisabledReason(selection: ExplorerSelection): string | undefined {
    if (!selection.length) return 'Select one or more sequence sets';
    if (!selectionHasOnlySequenceSets(selection)) return 'Deselect files to add sequence sets to a data collection';
    return undefined;
  }

  return {
    sequenceSets,
    dataCollections,
    keyToSequenceSetIds,
    sequenceSetsFilterIds,
    dataCollectionFilterId,
    sequenceSetsSectionExpanded,
    dataCollectionsSectionExpanded,
    showAllSequenceSets,
    loadingSequenceSets,
    loadingDataCollections,
    sequenceSetById,
    dataCollectionById,
    fetchSequenceSets,
    fetchDataCollections,
    refreshGroupingMetadata,
    applyFileSequenceSetIds,
    fileMatchesSequenceSetFilters,
    sequenceSetMatchesFilters,
    canAddToSequenceSet,
    canAddToDataCollection,
    addToSequenceSetDisabledReason,
    addToDataCollectionDisabledReason,
    selectedFileKeys,
    selectedSequenceSetIds,
  };
}
