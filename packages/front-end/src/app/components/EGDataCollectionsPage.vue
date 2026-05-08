<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
  }>();

  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const lab = computed<Laboratory | null>(() => labsStore.labs[props.labId] ?? null);
  const labRoot = computed(() => (lab.value ? `${lab.value.OrganizationId}/${lab.value.LaboratoryId}/` : ''));

  const tags = ref<LaboratoryDataTag[]>([]);
  const keyToTagIds = ref<Record<string, string[]>>({});
  /** Batch assignment per object key (tag ids with Kind batch are tracked separately from TagIds). */
  const keyToBatchTagId = ref<Record<string, string | undefined>>({});
  /**
   * Workflow tag ids associated with each file key. Populated alongside keyToTagIds so the
   * explorer can render an Analyzed/Not yet analyzed status and the left-rail Workflows
   * filter section can drive visibility.
   */
  const keyToWorkflowTagIds = ref<Record<string, string[]>>({});
  const files = ref<{ Key: string; Size?: number; LastModified?: string }[]>([]);
  const listingTruncated = ref(false);
  const selectedKeys = ref<string[]>([]);

  /**
   * The active filter in the left rail. "All samples" in the UI maps to `all` (no filter).
   * Tag, untagged, not-analyzed, workflow-template, and workflow-version are mutually exclusive.
   */
  type ActiveFilter =
    | { kind: 'all' }
    | { kind: 'untagged' }
    | { kind: 'tag'; tagId: string }
    | { kind: 'not-analyzed' }
    | { kind: 'workflow-template'; templateKey: string }
    | { kind: 'workflow-version'; tagId: string };
  const activeFilter = ref<ActiveFilter>({ kind: 'all' });
  /** Per-template open/close state for the workflows left-rail accordion. */
  const expandedWorkflowTemplates = ref<Record<string, boolean>>({});
  /** Whether the long-list "Show more" toggle is open for the workflow templates. */
  const showAllWorkflowTemplates = ref(false);
  /** Left-rail Tags / Workflows blocks start expanded. */
  const tagsSectionExpanded = ref(true);
  const workflowsSectionExpanded = ref(true);
  const search = ref('');

  const KEYS_CHUNK = 100;

  /** Bottom bulk panel: closed | add | remove */
  const bulkPanelMode = ref<'closed' | 'add' | 'remove'>('closed');
  /** Tag ids checked in Add Tags column (draft until Apply). */
  const bulkAddTagIds = ref<string[]>([]);
  /** Tag ids checked in Remove Tags column (draft until Apply). */
  const bulkRemoveTagIds = ref<string[]>([]);
  const showInlineCreateTag = ref(false);
  const inlineNewTagName = ref('');
  const inlineNewTagColor = ref('#5B4FD4');

  const loading = computed(() =>
    uiStore.anyRequestPending(['dataCollectionsList', 'dataCollectionsTags', 'dataCollectionsMutate']),
  );

  /** True while a bulk tag apply/remove is running through API + listing refresh (for disabling panel actions). */
  const bulkPanelBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));

  const hasSelection = computed(() => selectedKeys.value.length > 0);
  const bulkPanelOpen = computed(() => bulkPanelMode.value !== 'closed');

  function tagById(id: string): LaboratoryDataTag | undefined {
    return tags.value.find((t) => t.TagId === id);
  }

  /** True for workflow tags — Kind may be omitted in some API payloads; platform + external id is definitive. */
  function isWorkflowLaboratoryTag(t: LaboratoryDataTag | undefined): boolean {
    if (!t) return false;
    if (t.Kind === 'workflow') return true;
    return !!(t.Platform && t.WorkflowExternalId);
  }

  /**
   * Workflow tag ids for a file: prefer API `WorkflowTagIds`, else infer from raw `TagIds` using
   * tag metadata (needed when list-file-tags mis-buckets or tags load after file assignments).
   */
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

  /**
   * Tag ids that belong in the generic (user) tag pill row. The API splits workflow ids into
   * `WorkflowTagIds`, but mis-partitioning or missing `Kind` on list-tags must not show workflow
   * chips in the standard row.
   */
  function standardTagIdsForFileKey(key: string): string[] {
    const wf = new Set(workflowTagIdsForFileKey(key));
    return (keyToTagIds.value[key] || []).filter((tid: string) => {
      if (wf.has(tid)) return false;
      if (isWorkflowLaboratoryTag(tagById(tid))) return false;
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
    tags.value.filter((t) => (t.Kind ?? 'standard') === 'standard' && !isWorkflowLaboratoryTag(t)),
  );

  const batchTags = computed(() => tags.value.filter((t) => (t.Kind ?? 'standard') === 'batch'));

  const workflowTags = computed(() => tags.value.filter((t) => isWorkflowLaboratoryTag(t)));

  /**
   * Group workflow tags by (Platform, WorkflowExternalId) so the user sees one row per
   * workflow template in the left rail, with the individual versions exposed when the row
   * is expanded. The default version (empty WorkflowVersionName) is rendered as "default".
   */
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

  /**
   * Soft cap for the workflows left-rail before the "Show more" toggle kicks in. Picked to
   * roughly match the room available next to the Tags section without scrolling.
   */
  const WORKFLOW_TEMPLATE_COLLAPSED_LIMIT = 6;
  const visibleWorkflowTemplates = computed(() =>
    showAllWorkflowTemplates.value || workflowTemplates.value.length <= WORKFLOW_TEMPLATE_COLLAPSED_LIMIT
      ? workflowTemplates.value
      : workflowTemplates.value.slice(0, WORKFLOW_TEMPLATE_COLLAPSED_LIMIT),
  );

  function isFilterActive(target: ActiveFilter): boolean {
    const a = activeFilter.value;
    if (a.kind !== target.kind) return false;
    if (a.kind === 'tag' && target.kind === 'tag') return a.tagId === target.tagId;
    if (a.kind === 'workflow-template' && target.kind === 'workflow-template')
      return a.templateKey === target.templateKey;
    if (a.kind === 'workflow-version' && target.kind === 'workflow-version') return a.tagId === target.tagId;
    return true;
  }

  function setFilter(next: ActiveFilter): void {
    activeFilter.value = next;
  }

  function toggleWorkflowTemplate(templateKey: string): void {
    expandedWorkflowTemplates.value = {
      ...expandedWorkflowTemplates.value,
      [templateKey]: !expandedWorkflowTemplates.value[templateKey],
    };
  }

  function batchAssignmentLabelForKey(key: string): string {
    const bid = keyToBatchTagId.value[key];
    if (!bid) return 'Unbatched';
    return tagById(bid)?.Name ?? bid;
  }

  /** Distinct batch names for the current selection (Change batch modal). */
  const changeBatchCurrentlyInLine = computed(() => {
    const sel = selectedKeys.value;
    if (!sel.length) return '—';
    const names = new Set<string>();
    for (const key of sel) {
      names.add(batchAssignmentLabelForKey(key));
    }
    return [...names].sort((a, b) => a.localeCompare(b)).join(', ');
  });

  /** Tags present on the current selection, with count of selected files that have each tag. */
  const tagsOnSelection = computed(() => {
    const sel = selectedKeys.value;
    if (!sel.length) return [] as { tagId: string; count: number }[];
    const counts = new Map<string, number>();
    for (const key of sel) {
      for (const tid of standardTagIdsForFileKey(key)) {
        counts.set(tid, (counts.get(tid) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tagId, count]) => ({ tagId, count }))
      .sort((a, b) => {
        const na = tagById(a.tagId)?.Name ?? a.tagId;
        const nb = tagById(b.tagId)?.Name ?? b.tagId;
        return na.localeCompare(nb);
      });
  });

  /** Tag ids that appear on at least one selected file (for Remove column list). */
  const removableTagIds = computed(() => tagsOnSelection.value.map((t) => t.tagId));

  async function loadTags(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsTags');
    try {
      const res = await $api.dataCollections.listTags(props.labId);
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
        LaboratoryId: props.labId,
        Recursive: true,
        MaxTotalKeys: 25_000,
      });
      listingTruncated.value = !!res.ListingTruncated;
      files.value = (res.Contents || []).filter((c) => !c.Key.endsWith('/'));
      const keys = files.value.map((f) => f.Key);
      const map: Record<string, string[]> = {};
      const batchMap: Record<string, string | undefined> = {};
      const workflowMap: Record<string, string[]> = {};
      if (keys.length) {
        for (let i = 0; i < keys.length; i += KEYS_CHUNK) {
          const chunk = keys.slice(i, i + KEYS_CHUNK);
          const tr = await $api.dataCollections.requestListFileTags({
            LaboratoryId: props.labId,
            S3Bucket: lab.value.S3Bucket,
            Keys: chunk,
          });
          for (const f of tr.Files) {
            map[f.Key] = f.TagIds;
            batchMap[f.Key] = f.BatchTagId;
            workflowMap[f.Key] = f.WorkflowTagIds ?? [];
          }
        }
      }
      keyToTagIds.value = map;
      keyToBatchTagId.value = batchMap;
      keyToWorkflowTagIds.value = workflowMap;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load files: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsList');
    }
  }

  watch(
    () => [props.labId, lab.value?.S3Bucket],
    async () => {
      if (!lab.value?.S3Bucket) return;
      await loadTags();
      await loadListing();
    },
    { immediate: true },
  );

  /** Same first step as `visibleFiles` — used for sidebar chips so counts follow search. */
  const filesMatchingSearch = computed(() => {
    let list = files.value;
    const q = search.value.trim().toLowerCase();
    if (q) list = list.filter((f) => f.Key.toLowerCase().includes(q));
    return list;
  });

  const visibleFiles = computed(() => {
    let list = filesMatchingSearch.value;
    const af = activeFilter.value;
    switch (af.kind) {
      case 'all':
        break;
      case 'untagged':
        list = list.filter((f) => !standardTagIdsForFileKey(f.Key).length);
        break;
      case 'tag':
        list = list.filter((f) => standardTagIdsForFileKey(f.Key).includes(af.tagId));
        break;
      case 'not-analyzed':
        list = list.filter((f) => !(keyToWorkflowTagIdsEffective.value[f.Key] || []).length);
        break;
      case 'workflow-template': {
        const tmpl = workflowTemplates.value.find((t) => t.key === af.templateKey);
        const versionTagIds = new Set((tmpl?.versions || []).map((v) => v.tag.TagId));
        list = list.filter((f) =>
          (keyToWorkflowTagIdsEffective.value[f.Key] || []).some((id) => versionTagIds.has(id)),
        );
        break;
      }
      case 'workflow-version':
        list = list.filter((f) => (keyToWorkflowTagIdsEffective.value[f.Key] || []).includes(af.tagId));
        break;
    }
    return list;
  });

  /** Count for "All samples" chip — all loaded files matching search (same universe as no filter). */
  const allSamplesChipCount = computed(() => filesMatchingSearch.value.length);

  const notAnalyzedChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => !(keyToWorkflowTagIdsEffective.value[f.Key] || []).length).length,
  );

  /** Per standard-tag file counts among `filesMatchingSearch` (matches `case 'tag'` in `visibleFiles`). */
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

  function toggleKey(key: string): void {
    const s = new Set(selectedKeys.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    selectedKeys.value = [...s];
  }

  function selectAllDisplayed(): void {
    selectedKeys.value = visibleFiles.value.map((f) => f.Key);
  }

  function resetBulkPanelDraft(): void {
    bulkAddTagIds.value = [];
    bulkRemoveTagIds.value = [];
    showInlineCreateTag.value = false;
    inlineNewTagName.value = '';
    inlineNewTagColor.value = '#5B4FD4';
  }

  function closeBulkPanel(): void {
    bulkPanelMode.value = 'closed';
    resetBulkPanelDraft();
  }

  function openAddBulkPanel(): void {
    bulkPanelMode.value = 'add';
    resetBulkPanelDraft();
  }

  function openRemoveBulkPanel(): void {
    bulkPanelMode.value = 'remove';
    resetBulkPanelDraft();
  }

  function toggleBulkAddTag(tagId: string): void {
    const s = new Set(bulkAddTagIds.value);
    if (s.has(tagId)) s.delete(tagId);
    else s.add(tagId);
    bulkAddTagIds.value = [...s];
  }

  function toggleBulkRemoveTag(tagId: string): void {
    const s = new Set(bulkRemoveTagIds.value);
    if (s.has(tagId)) s.delete(tagId);
    else s.add(tagId);
    bulkRemoveTagIds.value = [...s];
  }

  async function addTagsToFilesInChunks(keys: string[], addTagIds: string[], removeTagIds: string[]): Promise<void> {
    if (!lab.value?.S3Bucket) return;
    const bucket = lab.value.S3Bucket;
    for (let i = 0; i < keys.length; i += KEYS_CHUNK) {
      const chunk = keys.slice(i, i + KEYS_CHUNK);
      await $api.dataCollections.addTagsToFiles({
        LaboratoryId: props.labId,
        S3Bucket: bucket,
        Keys: chunk,
        AddTagIds: addTagIds.length ? addTagIds : undefined,
        RemoveTagIds: removeTagIds.length ? removeTagIds : undefined,
      });
    }
  }

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

  async function createTagInline(): Promise<void> {
    if (!inlineNewTagName.value.trim()) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const created = await $api.dataCollections.createTag({
        LaboratoryId: props.labId,
        Name: inlineNewTagName.value.trim(),
        ColorHex: inlineNewTagColor.value,
      });
      await loadTags();
      bulkAddTagIds.value = [...new Set([...bulkAddTagIds.value, created.TagId])];
      showInlineCreateTag.value = false;
      inlineNewTagName.value = '';
      inlineNewTagColor.value = '#5B4FD4';
      toast.success('Tag created');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Create tag failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function applyBulkChanges(): Promise<void> {
    if (!lab.value?.S3Bucket || !selectedKeys.value.length) return;
    const keys = [...selectedKeys.value];
    const add = bulkPanelMode.value === 'add' ? bulkAddTagIds.value.filter(Boolean) : [];
    const remove = bulkPanelMode.value === 'remove' ? bulkRemoveTagIds.value.filter(Boolean) : [];
    if (bulkPanelMode.value === 'add' && !add.length) {
      toast.warning('Select at least one tag to add, or cancel.');
      return;
    }
    if (bulkPanelMode.value === 'remove' && !remove.length) {
      toast.warning('Select at least one tag to remove, or cancel.');
      return;
    }
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await addTagsToFilesInChunks(keys, add, remove);
      await loadTags();
      await loadListing();
      await nextTick();
      toast.success('Tags updated');
      closeBulkPanel();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Update failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function applyTagToKeys(tagId: string, keys: string[]): Promise<void> {
    if (!lab.value?.S3Bucket || !keys.length) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await addTagsToFilesInChunks(keys, [tagId], []);
      selectedKeys.value = [];
      await loadTags();
      await loadListing();
      await nextTick();
      toast.success('Tags updated');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Update failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function removeTagFromFile(key: string, tagId: string): Promise<void> {
    if (!lab.value?.S3Bucket) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.addTagsToFiles({
        LaboratoryId: props.labId,
        S3Bucket: lab.value.S3Bucket,
        Keys: [key],
        RemoveTagIds: [tagId],
      });
      await loadTags();
      await loadListing();
      await nextTick();
      toast.success('Tag removed');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Remove failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  function onCardDragOverTag(e: DragEvent): void {
    if (e.dataTransfer?.types.includes('application/x-eg-keys')) {
      e.preventDefault();
    }
  }

  function onTagRowDrop(e: DragEvent, tagId: string): void {
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-eg-keys');
    if (!raw) return;
    const keys: string[] = JSON.parse(raw) as string[];
    void applyTagToKeys(tagId, keys);
  }

  const showChangeBatchModal = ref(false);
  const changeBatchSelectedBatchId = ref<string | undefined>(undefined);
  const changeBatchNewName = ref('');

  watch(changeBatchNewName, (v) => {
    if (v.trim()) changeBatchSelectedBatchId.value = undefined;
  });
  watch(changeBatchSelectedBatchId, (v) => {
    if (v) changeBatchNewName.value = '';
  });

  function openChangeBatchModal(): void {
    changeBatchSelectedBatchId.value = undefined;
    changeBatchNewName.value = '';
    showChangeBatchModal.value = true;
  }

  function closeChangeBatchModal(): void {
    showChangeBatchModal.value = false;
  }

  function clearExistingBatchSelection(): void {
    changeBatchSelectedBatchId.value = undefined;
  }

  async function assignBatchInChunks(
    keys: string[],
    body: { ClearBatch?: boolean; BatchTagId?: string; NewBatchName?: string },
  ): Promise<void> {
    if (!lab.value?.S3Bucket) return;
    const bucket = lab.value.S3Bucket;
    for (let i = 0; i < keys.length; i += KEYS_CHUNK) {
      const chunk = keys.slice(i, i + KEYS_CHUNK);
      await $api.dataCollections.assignBatch({
        LaboratoryId: props.labId,
        S3Bucket: bucket,
        Keys: chunk,
        ...body,
      });
    }
  }

  async function applyChangeBatch(): Promise<void> {
    if (!lab.value?.S3Bucket || !selectedKeys.value.length) return;
    const keys = [...selectedKeys.value];
    const nn = changeBatchNewName.value.trim();
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      if (nn) {
        await assignBatchInChunks(keys, { NewBatchName: nn });
      } else if (changeBatchSelectedBatchId.value) {
        await assignBatchInChunks(keys, { BatchTagId: changeBatchSelectedBatchId.value });
      } else {
        toast.warning('Choose an existing batch or enter a new batch name.');
        return;
      }
      await loadTags();
      await loadListing();
      await nextTick();
      toast.success('Batch updated');
      closeChangeBatchModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Batch update failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function clearBatchFromModal(): Promise<void> {
    if (!lab.value?.S3Bucket || !selectedKeys.value.length) return;
    const keys = [...selectedKeys.value];
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await assignBatchInChunks(keys, { ClearBatch: true });
      await loadTags();
      await loadListing();
      await nextTick();
      toast.success('Removed from batch');
      closeChangeBatchModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Batch update failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <div v-if="!lab?.S3Bucket" class="text-muted rounded-lg border border-dashed p-8 text-center text-sm">
    This lab has no S3 bucket configured. Set a bucket in Lab Settings to use Data Collections.
  </div>
  <div
    v-else
    class="flex min-h-[480px] min-w-0 flex-col gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
  >
    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div class="border-border-muted flex w-[280px] shrink-0 flex-col overflow-y-auto border-r bg-gray-50">
        <div class="border-border-muted border-b p-2">
          <button
            type="button"
            class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
            :class="{ 'bg-primary-muted font-medium': isFilterActive({ kind: 'all' }) }"
            @click="setFilter({ kind: 'all' })"
          >
            <span>All samples</span>
            <UBadge
              size="xs"
              class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
            >
              {{ allSamplesChipCount }}
            </UBadge>
          </button>
          <button
            type="button"
            class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
            :class="{ 'bg-primary-muted font-medium': isFilterActive({ kind: 'not-analyzed' }) }"
            @click="setFilter({ kind: 'not-analyzed' })"
          >
            <span>Not yet analyzed</span>
            <UBadge
              size="xs"
              class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
            >
              {{ notAnalyzedChipCount }}
            </UBadge>
          </button>
        </div>

        <div class="border-border-muted border-b p-2">
          <button
            type="button"
            class="text-muted hover:bg-primary-muted mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium uppercase tracking-wide"
            :aria-expanded="tagsSectionExpanded"
            @click="tagsSectionExpanded = !tagsSectionExpanded"
          >
            <UIcon
              :name="tagsSectionExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
              class="h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>Tags</span>
          </button>
          <div v-show="tagsSectionExpanded">
            <button
              type="button"
              class="hover:bg-primary-muted flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm"
              :class="{ 'bg-primary-muted font-medium': isFilterActive({ kind: 'untagged' }) }"
              @click="setFilter({ kind: 'untagged' })"
            >
              <span>Untagged</span>
            </button>
            <button
              v-for="t in standardTags"
              :key="t.TagId"
              class="hover:bg-primary-muted flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
              :class="{ 'bg-primary-muted font-medium': isFilterActive({ kind: 'tag', tagId: t.TagId }) }"
              @click="setFilter({ kind: 'tag', tagId: t.TagId })"
              @dragover.prevent="onCardDragOverTag"
              @drop="onTagRowDrop($event, t.TagId)"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
                <span class="truncate">{{ t.Name }}</span>
              </span>
              <UBadge
                size="xs"
                class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
              >
                {{ standardTagIdToChipCount[t.TagId] ?? 0 }}
              </UBadge>
            </button>
          </div>
        </div>

        <div class="p-2">
          <button
            type="button"
            class="text-muted hover:bg-primary-muted mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium uppercase tracking-wide"
            :aria-expanded="workflowsSectionExpanded"
            @click="workflowsSectionExpanded = !workflowsSectionExpanded"
          >
            <UIcon
              :name="workflowsSectionExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
              class="h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>Workflows</span>
          </button>
          <div v-show="workflowsSectionExpanded">
            <p v-if="!workflowTemplates.length" class="text-muted mt-2 px-2 text-xs italic">
              No workflows have been run on these files yet.
            </p>

            <div v-for="tmpl in visibleWorkflowTemplates" :key="tmpl.key" class="mt-1">
              <div
                class="hover:bg-primary-muted flex w-full cursor-pointer items-center gap-1 rounded-lg pr-2 text-left text-sm"
                :class="{
                  'bg-primary-muted font-medium': isFilterActive({ kind: 'workflow-template', templateKey: tmpl.key }),
                }"
              >
                <button
                  v-if="tmpl.versions.length > 1"
                  type="button"
                  class="text-muted hover:text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  :aria-label="expandedWorkflowTemplates[tmpl.key] ? 'Collapse versions' : 'Expand versions'"
                  @click.stop="toggleWorkflowTemplate(tmpl.key)"
                >
                  <UIcon
                    :name="
                      expandedWorkflowTemplates[tmpl.key] ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'
                    "
                    class="h-4 w-4"
                  />
                </button>
                <span v-else class="block h-7 w-7 shrink-0" />
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 text-left"
                  @click="setFilter({ kind: 'workflow-template', templateKey: tmpl.key })"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: tmpl.color }" />
                    <span class="truncate">{{ tmpl.name }}</span>
                  </span>
                  <span class="text-muted shrink-0 text-xs">{{ tmpl.fileCount }}</span>
                </button>
              </div>

              <div v-if="expandedWorkflowTemplates[tmpl.key] && tmpl.versions.length > 1" class="ml-7 mt-0.5">
                <button
                  v-for="v in tmpl.versions"
                  :key="v.tag.TagId"
                  type="button"
                  class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                  :class="{
                    'bg-primary-muted font-medium': isFilterActive({ kind: 'workflow-version', tagId: v.tag.TagId }),
                  }"
                  @click="setFilter({ kind: 'workflow-version', tagId: v.tag.TagId })"
                >
                  <span class="text-muted truncate">{{ v.label }}</span>
                  <span class="text-muted shrink-0 tabular-nums">{{ v.tag.FileCount }}</span>
                </button>
              </div>
            </div>

            <button
              v-if="workflowTemplates.length > visibleWorkflowTemplates.length || showAllWorkflowTemplates"
              v-show="workflowTemplates.length > 6"
              type="button"
              class="text-primary mt-2 px-2 text-xs font-medium hover:underline"
              @click="showAllWorkflowTemplates = !showAllWorkflowTemplates"
            >
              {{
                showAllWorkflowTemplates
                  ? 'Show fewer'
                  : `Show ${workflowTemplates.length - visibleWorkflowTemplates.length} more`
              }}
            </button>
          </div>
        </div>
      </div>

      <EGDataCollectionsExplorer
        class="min-h-0 min-w-0 flex-1"
        :lab-root="labRoot"
        :visible-files="visibleFiles"
        :key-to-tag-ids="keyToStandardTagIdsForExplorer"
        :key-to-batch-tag-id="keyToBatchTagId"
        :key-to-workflow-tag-ids="keyToWorkflowTagIdsEffective"
        :batch-tags="batchTags"
        :tags="tags"
        :selected-keys="selectedKeys"
        :loading="loading"
        :search="search"
        :listing-file-count="files.length"
        :listing-truncated="listingTruncated"
        @update:search="search = $event"
        @update:selected-keys="selectedKeys = $event"
        @toggle-key="toggleKey"
        @select-all-displayed="selectAllDisplayed"
        @clear-selection="selectedKeys = []"
        @remove-tag-from-file="removeTagFromFile($event.key, $event.tagId)"
      />
    </div>

    <div class="border-border-muted shrink-0 border-t bg-gray-50">
      <div class="flex flex-wrap items-center gap-2 px-4 py-2">
        <span v-if="hasSelection" class="text-muted text-xs">{{ selectedKeys.length }} file(s) selected</span>
        <span v-else class="text-muted text-xs">Select files in the grid to add or remove tags in bulk.</span>
        <div v-if="hasSelection" class="ml-auto flex flex-wrap items-center gap-2">
          <UIcon v-if="bulkPanelBusy" name="i-heroicons-arrow-path" class="text-muted h-5 w-5 shrink-0 animate-spin" />
          <UButton size="sm" variant="soft" :disabled="bulkPanelBusy" @click="openAddBulkPanel">Add Tags</UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openRemoveBulkPanel">
            Remove Tags
          </UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openChangeBatchModal">
            Change Batch
          </UButton>
        </div>
      </div>

      <div v-if="bulkPanelOpen" class="border-border-muted relative border-t bg-white px-4 pb-4 pt-3">
        <div
          v-if="bulkPanelBusy"
          class="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]"
          aria-busy="true"
          aria-label="Updating tags and file list"
        >
          <div class="text-muted flex flex-col items-center gap-2 text-sm">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin" />
            <span>Updating tags…</span>
          </div>
        </div>
        <div class="grid gap-6 md:grid-cols-2">
          <div>
            <h3 class="text-muted mb-3 text-xs font-semibold uppercase tracking-wide">On Selection</h3>
            <p v-if="!tagsOnSelection.length" class="text-muted text-sm">No tags on the selected files.</p>
            <ul v-else class="space-y-2 text-sm">
              <li
                v-for="row in tagsOnSelection"
                :key="row.tagId"
                class="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2"
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    :style="{ background: tagById(row.tagId)?.ColorHex || '#ccc' }"
                  />
                  <span class="truncate font-medium">{{ tagById(row.tagId)?.Name ?? row.tagId }}</span>
                </span>
                <span class="text-muted shrink-0 text-xs tabular-nums">
                  {{ row.count }} / {{ selectedKeys.length }}
                </span>
              </li>
            </ul>
          </div>

          <div v-if="bulkPanelMode === 'add'">
            <h3 class="text-muted mb-3 text-xs font-semibold uppercase tracking-wide">Add Tags</h3>
            <ul class="max-h-56 space-y-2 overflow-y-auto pr-1 text-sm">
              <li
                v-for="t in standardTags"
                :key="'add-' + t.TagId"
                class="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-gray-50"
              >
                <UCheckbox
                  :model-value="bulkAddTagIds.includes(t.TagId)"
                  @update:model-value="toggleBulkAddTag(t.TagId)"
                />
                <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
                <span class="truncate">{{ t.Name }}</span>
              </li>
            </ul>
            <div class="mt-3 border-t border-gray-100 pt-3">
              <button
                v-if="!showInlineCreateTag"
                type="button"
                class="text-primary text-sm font-medium hover:underline"
                @click="showInlineCreateTag = true"
              >
                + Create new tag
              </button>
              <div v-else class="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                <UInput v-model="inlineNewTagName" placeholder="Tag name" size="sm" />
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="c in presetColors"
                    :key="c"
                    type="button"
                    class="h-7 w-7 rounded border-2"
                    :class="inlineNewTagColor === c ? 'border-primary' : 'border-transparent'"
                    :style="{ background: c }"
                    @click="inlineNewTagColor = c"
                  />
                </div>
                <UInput v-model="inlineNewTagColor" placeholder="#RRGGBB" size="sm" />
                <div class="flex gap-2">
                  <UButton size="xs" variant="ghost" @click="showInlineCreateTag = false">Close</UButton>
                  <UButton size="xs" :disabled="!inlineNewTagName.trim()" :loading="loading" @click="createTagInline">
                    Create
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="bulkPanelMode === 'remove'">
            <h3 class="text-muted mb-3 text-xs font-semibold uppercase tracking-wide">Remove Tags</h3>
            <p v-if="!removableTagIds.length" class="text-muted text-sm">No tags on the selected files to remove.</p>
            <ul v-else class="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
              <li
                v-for="tid in removableTagIds"
                :key="'rm-' + tid"
                class="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-gray-50"
              >
                <UCheckbox
                  :model-value="bulkRemoveTagIds.includes(tid)"
                  @update:model-value="toggleBulkRemoveTag(tid)"
                />
                <span
                  class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  :style="{ background: tagById(tid)?.ColorHex || '#ccc' }"
                />
                <span class="truncate">{{ tagById(tid)?.Name ?? tid }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="closeBulkPanel">Cancel</UButton>
          <UButton size="sm" :loading="bulkPanelBusy" @click="applyBulkChanges">Apply changes</UButton>
        </div>
      </div>
    </div>

    <UModal
      v-model="showChangeBatchModal"
      :ui="{
        overlay: {
          base: 'fixed inset-0 transition-opacity backdrop-blur-[5px]',
          background: 'bg-gray-800/30',
        },
        rounded: 'rounded-3xl',
        width: 'sm:max-w-lg',
      }"
    >
      <UCard
        :ui="{
          base: 'p-8',
          rounded: 'rounded-3xl',
          header: { padding: '' },
        }"
      >
        <template #header>
          <div class="flex flex-col gap-1">
            <h3 class="text-lg font-semibold text-gray-900">Change batch</h3>
            <p class="text-muted text-sm">Reassign the selected samples to a different batch.</p>
          </div>
        </template>

        <div class="space-y-4">
          <div class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <dl class="space-y-2.5 text-sm">
              <div class="flex items-baseline justify-between gap-4">
                <dt class="text-muted shrink-0">Samples to move</dt>
                <dd class="font-medium tabular-nums text-gray-900">{{ selectedKeys.length }}</dd>
              </div>
              <div class="flex items-start justify-between gap-4">
                <dt class="text-muted shrink-0 pt-0.5">Currently in</dt>
                <dd class="min-w-0 flex-1 break-words text-right font-medium leading-snug text-gray-900">
                  {{ changeBatchCurrentlyInLine }}
                </dd>
              </div>
            </dl>
          </div>
          <div>
            <div class="mb-1 flex items-center justify-between gap-2">
              <label class="text-muted block text-xs font-semibold uppercase tracking-wide">Existing batch</label>
              <button
                v-if="changeBatchSelectedBatchId"
                type="button"
                class="text-primary shrink-0 text-xs font-normal hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="bulkPanelBusy || !!changeBatchNewName.trim()"
                @click="clearExistingBatchSelection"
              >
                Clear selection
              </button>
            </div>
            <USelectMenu
              v-model="changeBatchSelectedBatchId"
              :options="batchTags"
              option-attribute="Name"
              value-attribute="TagId"
              placeholder="Select a batch"
              size="sm"
              class="w-full"
              :disabled="bulkPanelBusy || !!changeBatchNewName.trim()"
            />
          </div>
          <div>
            <label class="text-muted mb-1 block text-xs font-semibold uppercase tracking-wide">
              Or create new batch
            </label>
            <UInput
              v-model="changeBatchNewName"
              placeholder="e.g. Nov-2024-FluPanel"
              size="sm"
              class="w-full"
              :disabled="bulkPanelBusy || !!changeBatchSelectedBatchId"
            />
            <p class="text-muted mt-1.5 text-xs leading-snug">Leave blank to use the existing batch selected above.</p>
          </div>
        </div>

        <div class="mt-8 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
          <UButton size="sm" variant="ghost" :disabled="bulkPanelBusy" @click="closeChangeBatchModal">Cancel</UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="clearBatchFromModal">
            Remove from batch
          </UButton>
          <UButton size="sm" :loading="bulkPanelBusy" @click="applyChangeBatch">Move samples</UButton>
        </div>
      </UCard>
    </UModal>
  </div>
</template>
