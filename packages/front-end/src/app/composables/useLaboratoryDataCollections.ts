import type {
  LaboratoryDataTag,
  LaboratoryRunUsageSummary,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';
import {
  dataCollectionFileKind,
  enabledFileTypeKinds,
  fileMatchesFileTypeFilter,
  groupHiddenFilesByTypeLabel,
  type DataCollectionFileTypeFilter,
} from '@FE/utils/data-collections-file-type';
import { isExpiringSoon } from '@FE/utils/data-collections-filters';

export type DataCollectionsScopeFilter =
  | { kind: 'all' }
  | { kind: 'not-analyzed' }
  | { kind: 'expiring-soon' }
  | { kind: 'workflow-template'; templateKey: string }
  | { kind: 'workflow-version'; tagId: string };

export type UseLaboratoryDataCollectionsOptions = {
  /** Tag filters + search only; scope locked to all; all file types visible. */
  pickerMode?: boolean;
};

const KEYS_CHUNK = 100;

const EXPIRING_SOON_DEFAULT_DAYS = 30;
const EXPIRING_SOON_MIN_DAYS = 1;
const EXPIRING_SOON_MAX_DAYS = 365;

function readPersistedExpiringSoonDays(labId: string): number {
  if (typeof window === 'undefined') return EXPIRING_SOON_DEFAULT_DAYS;
  try {
    const raw = window.localStorage?.getItem(`eg.dataCollections.${labId}.expiringSoonDays`);
    const n = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return EXPIRING_SOON_DEFAULT_DAYS;
    return Math.min(EXPIRING_SOON_MAX_DAYS, Math.max(EXPIRING_SOON_MIN_DAYS, Math.floor(n)));
  } catch {
    return EXPIRING_SOON_DEFAULT_DAYS;
  }
}

export function useLaboratoryDataCollections(
  labId: MaybeRefOrGetter<string>,
  options: UseLaboratoryDataCollectionsOptions = {},
) {
  const pickerMode = options.pickerMode ?? false;

  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const labIdValue = computed(() => toValue(labId));

  const lab = computed<Laboratory | null>(() => labsStore.labs[labIdValue.value] ?? null);
  const labRoot = computed(() => (lab.value ? `${lab.value.OrganizationId}/${lab.value.LaboratoryId}/` : ''));

  const tags = ref<LaboratoryDataTag[]>([]);
  const keyToTagIds = ref<Record<string, string[]>>({});
  const keyToBatchTagId = ref<Record<string, string | undefined>>({});
  const keyToWorkflowTagIds = ref<Record<string, string[]>>({});
  const keyToIsPermanent = ref<Record<string, boolean>>({});
  const keyToRunUsages = ref<Record<string, LaboratoryRunUsageSummary[]>>({});
  const files = ref<{ Key: string; Size?: number; LastModified?: string }[]>([]);
  const listingTruncated = ref(false);
  const selectedKeys = ref<string[]>([]);

  const scopeFilter = ref<DataCollectionsScopeFilter>({ kind: 'all' });
  const expiringSoonThresholdDays = ref<number>(readPersistedExpiringSoonDays(labIdValue.value));
  const tagsFilterUntagged = ref(false);
  const tagsFilterTagIds = ref<string[]>([]);
  const search = ref('');

  const fileTypeFilterEnabled = ref<DataCollectionFileTypeFilter>(
    pickerMode ? { fastq: true, fasta: true, other: true } : { fastq: true, fasta: false, other: false },
  );

  watch(expiringSoonThresholdDays, (next) => {
    if (pickerMode || typeof window === 'undefined') return;
    try {
      const clamped = Math.min(EXPIRING_SOON_MAX_DAYS, Math.max(EXPIRING_SOON_MIN_DAYS, Math.floor(Number(next) || 0)));
      if (clamped !== next) expiringSoonThresholdDays.value = clamped;
      window.localStorage?.setItem(`eg.dataCollections.${labIdValue.value}.expiringSoonDays`, String(clamped));
    } catch {
      // ignore
    }
  });

  watch(labIdValue, (next) => {
    if (!pickerMode) {
      expiringSoonThresholdDays.value = readPersistedExpiringSoonDays(next);
    }
  });

  const loading = computed(() =>
    uiStore.anyRequestPending(['dataCollectionsList', 'dataCollectionsTags', 'dataCollectionsMutate']),
  );

  function tagById(id: string): LaboratoryDataTag | undefined {
    return tags.value.find((t) => t.TagId === id);
  }

  function isWorkflowLaboratoryTag(t: LaboratoryDataTag | undefined): boolean {
    if (!t) return false;
    if (t.Kind === 'workflow') return true;
    return !!(t.Platform && t.WorkflowExternalId);
  }

  const permanentTag = computed<LaboratoryDataTag | undefined>(() => tags.value.find((t) => t.Kind === 'permanent'));
  const permanentTagId = computed<string | undefined>(() => permanentTag.value?.TagId);

  function isFilePermanent(key: string): boolean {
    if (keyToIsPermanent.value[key]) return true;
    const pid = permanentTagId.value;
    if (!pid) return false;
    return (keyToTagIds.value[key] || []).includes(pid);
  }

  function workflowTagIdsForFileKey(key: string): string[] {
    const fromApi = keyToWorkflowTagIds.value[key] ?? [];
    const raw = keyToTagIds.value[key] ?? [];
    const merged = new Set<string>(fromApi);
    if (tags.value.length) {
      for (const tid of raw) {
        if (isWorkflowLaboratoryTag(tagById(tid))) {
          merged.add(tid);
        }
      }
    }
    return [...merged];
  }

  const keyToWorkflowTagIdsEffective = computed(() => {
    const m: Record<string, string[]> = {};
    for (const f of files.value) {
      m[f.Key] = workflowTagIdsForFileKey(f.Key);
    }
    return m;
  });

  function standardTagIdsForFileKey(key: string): string[] {
    const wf = new Set(workflowTagIdsForFileKey(key));
    const pid = permanentTagId.value;
    return (keyToTagIds.value[key] || []).filter((tid: string) => {
      if (wf.has(tid)) return false;
      if (isWorkflowLaboratoryTag(tagById(tid))) return false;
      if (pid && tid === pid) return false;
      const tag = tagById(tid);
      if (tag?.Kind === 'permanent') return false;
      return true;
    });
  }

  const keyToStandardTagIdsForExplorer = computed(() => {
    const m: Record<string, string[]> = {};
    for (const f of files.value) {
      m[f.Key] = standardTagIdsForFileKey(f.Key);
    }
    return m;
  });

  const standardTags = computed(() =>
    tags.value.filter(
      (t) => (t.Kind ?? 'standard') === 'standard' && t.Kind !== 'permanent' && !isWorkflowLaboratoryTag(t),
    ),
  );

  const batchTags = computed(() => tags.value.filter((t) => (t.Kind ?? 'standard') === 'batch'));

  const workflowTags = computed(() => tags.value.filter((t) => isWorkflowLaboratoryTag(t)));

  type WorkflowTemplate = {
    key: string;
    platform: string;
    externalId: string;
    name: string;
    color: string;
    fileCount: number;
    versions: { tag: LaboratoryDataTag; label: string }[];
  };

  const workflowTemplates = computed<WorkflowTemplate[]>(() => {
    const grouped = new Map<string, WorkflowTemplate>();
    for (const t of workflowTags.value) {
      const platform = t.Platform ?? '';
      const externalId = t.WorkflowExternalId ?? t.TagId;
      const key = `${platform}#${externalId}`;
      const existing = grouped.get(key);
      const versionLabel = t.WorkflowVersionName?.trim() ? t.WorkflowVersionName.trim() : 'default';
      if (existing) {
        existing.fileCount += t.FileCount ?? 0;
        existing.versions.push({ tag: t, label: versionLabel });
      } else {
        grouped.set(key, {
          key,
          platform,
          externalId,
          name: t.Name,
          color: t.ColorHex,
          fileCount: t.FileCount ?? 0,
          versions: [{ tag: t, label: versionLabel }],
        });
      }
    }
    const list = [...grouped.values()];
    for (const tmpl of list) {
      tmpl.versions.sort((a, b) => a.label.localeCompare(b.label));
    }
    list.sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
    return list;
  });

  async function loadTags(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsTags');
    try {
      const res = await $api.dataCollections.listTags(labIdValue.value);
      tags.value = res.Tags;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load tags: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsTags');
    }
  }

  async function loadListing(): Promise<void> {
    if (!lab.value?.S3Bucket) return;
    uiStore.setRequestPending('dataCollectionsList');
    try {
      const res = await $api.dataCollections.requestLaboratoryBucketObjects({
        LaboratoryId: labIdValue.value,
        MaxTotalKeys: 25_000,
      });
      const nextTruncated = !!res.ListingTruncated;
      const nextFiles = (res.Contents || []).filter((c) => !c.Key.endsWith('/'));
      const keys = nextFiles.map((f) => f.Key);
      const map: Record<string, string[]> = {};
      const batchMap: Record<string, string | undefined> = {};
      const workflowMap: Record<string, string[]> = {};
      const permanentMap: Record<string, boolean> = {};
      const runUsagesMap: Record<string, LaboratoryRunUsageSummary[]> = {};
      if (keys.length) {
        for (let i = 0; i < keys.length; i += KEYS_CHUNK) {
          const chunk = keys.slice(i, i + KEYS_CHUNK);
          const tr = await $api.dataCollections.requestListFileTags({
            LaboratoryId: labIdValue.value,
            S3Bucket: lab.value.S3Bucket,
            Keys: chunk,
          });
          for (const f of tr.Files) {
            map[f.Key] = f.TagIds;
            batchMap[f.Key] = f.BatchTagId;
            workflowMap[f.Key] = f.WorkflowTagIds ?? [];
            permanentMap[f.Key] = !!f.IsPermanent;
            runUsagesMap[f.Key] = f.LaboratoryRunUsages ?? [];
          }
        }
      }
      listingTruncated.value = nextTruncated;
      files.value = nextFiles;
      keyToTagIds.value = map;
      keyToBatchTagId.value = batchMap;
      keyToWorkflowTagIds.value = workflowMap;
      keyToIsPermanent.value = permanentMap;
      keyToRunUsages.value = runUsagesMap;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load files: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsList');
    }
  }

  watch(
    () => [labIdValue.value, lab.value?.S3Bucket],
    async () => {
      if (!lab.value?.S3Bucket) return;
      await loadTags();
      await loadListing();
    },
    { immediate: true },
  );

  const filesMatchingSearch = computed(() => {
    let list = files.value;
    const q = search.value.trim().toLowerCase();
    if (q) list = list.filter((f) => f.Key.toLowerCase().includes(q));
    return list;
  });

  function runCountForFileKey(key: string): number {
    return keyToRunUsages.value[key]?.length ?? 0;
  }

  function isFileExpiringSoon(key: string): boolean {
    return isExpiringSoon({
      isPermanent: isFilePermanent(key),
      usages: keyToRunUsages.value[key],
      thresholdDays: expiringSoonThresholdDays.value,
      nowEpoch: Math.floor(Date.now() / 1000),
    });
  }

  const filesBeforeFileTypeFilter = computed(() => {
    let list = filesMatchingSearch.value;
    if (pickerMode) {
      if (tagsFilterUntagged.value) {
        list = list.filter((f) => !standardTagIdsForFileKey(f.Key).length && !isFilePermanent(f.Key));
      } else if (tagsFilterTagIds.value.length > 0) {
        const selected = new Set(tagsFilterTagIds.value);
        const pid = permanentTagId.value;
        list = list.filter(
          (f) =>
            standardTagIdsForFileKey(f.Key).some((tid: string) => selected.has(tid)) ||
            (!!pid && selected.has(pid) && isFilePermanent(f.Key)),
        );
      }
      return list;
    }

    const sf = scopeFilter.value;
    switch (sf.kind) {
      case 'all':
        break;
      case 'not-analyzed':
        list = list.filter((f) => runCountForFileKey(f.Key) === 0);
        break;
      case 'expiring-soon':
        list = list.filter((f) => isFileExpiringSoon(f.Key));
        break;
      case 'workflow-template': {
        const tmpl = workflowTemplates.value.find((t) => t.key === sf.templateKey);
        const versionTagIds = new Set((tmpl?.versions || []).map((v) => v.tag.TagId));
        list = list.filter((f) =>
          (keyToWorkflowTagIdsEffective.value[f.Key] || []).some((id) => versionTagIds.has(id)),
        );
        break;
      }
      case 'workflow-version':
        list = list.filter((f) => (keyToWorkflowTagIdsEffective.value[f.Key] || []).includes(sf.tagId));
        break;
    }
    if (tagsFilterUntagged.value) {
      list = list.filter((f) => !standardTagIdsForFileKey(f.Key).length && !isFilePermanent(f.Key));
    } else if (tagsFilterTagIds.value.length > 0) {
      const selected = new Set(tagsFilterTagIds.value);
      const pid = permanentTagId.value;
      list = list.filter(
        (f) =>
          standardTagIdsForFileKey(f.Key).some((tid: string) => selected.has(tid)) ||
          (!!pid && selected.has(pid) && isFilePermanent(f.Key)),
      );
    }
    return list;
  });

  const enabledFileTypes = computed(() => enabledFileTypeKinds(fileTypeFilterEnabled.value));

  const visibleFiles = computed(() => {
    const kinds = enabledFileTypes.value;
    return filesBeforeFileTypeFilter.value.filter((f) => fileMatchesFileTypeFilter(f.Key, kinds));
  });

  const fileTypeCounts = computed(() => {
    const counts = { fastq: 0, fasta: 0, other: 0 };
    for (const f of filesMatchingSearch.value) {
      counts[dataCollectionFileKind(f.Key)] += 1;
    }
    return counts;
  });

  const hiddenByFileTypeCount = computed(() => filesBeforeFileTypeFilter.value.length - visibleFiles.value.length);

  const hiddenByFileTypeBreakdown = computed(() => {
    const kinds = enabledFileTypes.value;
    const hidden = filesBeforeFileTypeFilter.value.filter((f) => !fileMatchesFileTypeFilter(f.Key, kinds));
    return groupHiddenFilesByTypeLabel(hidden);
  });

  const permanentTaggedFileCountInSearch = computed(
    () => filesMatchingSearch.value.filter((f) => isFilePermanent(f.Key)).length,
  );

  const leftRailTagFilterTags = computed(() => {
    const std = standardTags.value;
    const p = permanentTag.value;
    if (!p || permanentTaggedFileCountInSearch.value === 0) return std;
    return [...std, p];
  });

  const standardTagIdToChipCount = computed((): Record<string, number> => {
    const tagIds = new Set<string>(standardTags.value.map((t: LaboratoryDataTag) => t.TagId));
    const counts = new Map<string, number>();
    for (const id of tagIds) counts.set(id, 0);
    for (const f of filesMatchingSearch.value) {
      for (const tid of standardTagIdsForFileKey(f.Key)) {
        if (tagIds.has(tid)) counts.set(tid, (counts.get(tid) ?? 0) + 1);
      }
    }
    const out: Record<string, number> = {};
    for (const [k, v] of counts) out[k] = v;
    return out;
  });

  const untaggedChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => !standardTagIdsForFileKey(f.Key).length).length,
  );

  const allSamplesChipCount = computed(() => filesMatchingSearch.value.length);

  const notAnalyzedChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => runCountForFileKey(f.Key) === 0).length,
  );

  const expiringSoonChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => isFileExpiringSoon(f.Key)).length,
  );

  function isUntaggedTagFilterActive(): boolean {
    return tagsFilterUntagged.value;
  }

  function isStandardTagFilterActive(tagId: string): boolean {
    return tagsFilterTagIds.value.includes(tagId);
  }

  function onUntaggedTagFilterClick(): void {
    if (tagsFilterUntagged.value) {
      tagsFilterUntagged.value = false;
      return;
    }
    tagsFilterUntagged.value = true;
    tagsFilterTagIds.value = [];
  }

  function onStandardTagFilterClick(tagId: string): void {
    const idx = tagsFilterTagIds.value.indexOf(tagId);
    if (idx >= 0) {
      tagsFilterTagIds.value = tagsFilterTagIds.value.filter((id: string) => id !== tagId);
      return;
    }
    tagsFilterUntagged.value = false;
    tagsFilterTagIds.value = [...tagsFilterTagIds.value, tagId];
  }

  function toggleKey(key: string): void {
    const s = new Set(selectedKeys.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    selectedKeys.value = [...s];
  }

  function selectAllDisplayed(): void {
    selectedKeys.value = visibleFiles.value.map((f) => f.Key);
  }

  function clearSelection(): void {
    selectedKeys.value = [];
  }

  function selectFilesForRun(payload: { runId: string; inputFileKeys: string[] }): void {
    const loadedKeys = new Set(files.value.map((f) => f.Key));
    selectedKeys.value = payload.inputFileKeys.filter((k) => loadedKeys.has(k));
  }

  async function addTagsToFilesInChunks(keys: string[], addTagIds: string[], removeTagIds: string[]): Promise<void> {
    if (!lab.value?.S3Bucket) return;
    const bucket = lab.value.S3Bucket;
    for (let i = 0; i < keys.length; i += KEYS_CHUNK) {
      const chunk = keys.slice(i, i + KEYS_CHUNK);
      await $api.dataCollections.addTagsToFiles({
        LaboratoryId: labIdValue.value,
        S3Bucket: bucket,
        Keys: chunk,
        AddTagIds: addTagIds.length ? addTagIds : undefined,
        RemoveTagIds: removeTagIds.length ? removeTagIds : undefined,
      });
    }
    await loadListing();
  }

  async function refresh(): Promise<void> {
    await loadTags();
    await loadListing();
  }

  return {
    lab,
    labRoot,
    tags,
    permanentTag,
    permanentTagId,
    keyToTagIds,
    keyToBatchTagId,
    keyToWorkflowTagIds,
    keyToIsPermanent,
    keyToRunUsages,
    keyToStandardTagIdsForExplorer,
    keyToWorkflowTagIdsEffective,
    files,
    listingTruncated,
    selectedKeys,
    scopeFilter,
    expiringSoonThresholdDays,
    tagsFilterUntagged,
    tagsFilterTagIds,
    search,
    fileTypeFilterEnabled,
    loading,
    standardTags,
    batchTags,
    workflowTags,
    workflowTemplates,
    visibleFiles,
    filesMatchingSearch,
    fileTypeCounts,
    hiddenByFileTypeCount,
    hiddenByFileTypeBreakdown,
    leftRailTagFilterTags,
    standardTagIdToChipCount,
    untaggedChipCount,
    allSamplesChipCount,
    notAnalyzedChipCount,
    expiringSoonChipCount,
    permanentTaggedFileCountInSearch,
    tagById,
    standardTagIdsForFileKey,
    isFilePermanent,
    runCountForFileKey,
    loadTags,
    loadListing,
    refresh,
    toggleKey,
    selectAllDisplayed,
    clearSelection,
    selectFilesForRun,
    addTagsToFilesInChunks,
    isUntaggedTagFilterActive,
    isStandardTagFilterActive,
    onUntaggedTagFilterClick,
    onStandardTagFilterClick,
  };
}
