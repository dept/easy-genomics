<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type {
    LaboratoryDataTag,
    LaboratoryRunUsageSummary,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';
  import { isExpiringSoon } from '@FE/utils/data-collections-filters';
  import {
    dataCollectionFileKind,
    enabledFileTypeKinds,
    fileMatchesFileTypeFilter,
    groupHiddenFilesByTypeLabel,
    type DataCollectionFileTypeFilter,
  } from '@FE/utils/data-collections-file-type';
  import { exceedsBatchNameMaxLength, exceedsTagNameMaxLength } from '@FE/utils/data-collections-name-validation';
  import { useLaboratoryDataCollections } from '@FE/composables/useLaboratoryDataCollections';

  const props = defineProps<{
    labId: string;
  }>();

  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const labIdRef = toRef(() => props.labId);
  const dc = useLaboratoryDataCollections(labIdRef);

  const lab = dc.lab;
  const labRoot = dc.labRoot;

  const tags = dc.tags;
  const keyToTagIds = dc.keyToTagIds;
  const keyToBatchTagId = dc.keyToBatchTagId;
  const keyToWorkflowTagIds = dc.keyToWorkflowTagIds;
  const keyToIsPermanent = dc.keyToIsPermanent;
  const keyToRunUsages = dc.keyToRunUsages;
  const files = dc.files;
  const listingTruncated = dc.listingTruncated;
  const selectedKeys = dc.selectedKeys;

  /**
   * Scope rail filter: at most one of all | not-yet-analyzed | expiring-soon | workflow template | workflow version.
   * Tags section (untagged + multiple standard tags) applies on top with OR semantics among selected tags.
   */
  type ScopeFilter =
    | { kind: 'all' }
    | { kind: 'not-analyzed' }
    | { kind: 'expiring-soon' }
    | { kind: 'workflow-template'; templateKey: string }
    | { kind: 'workflow-version'; tagId: string };

  const scopeFilter = dc.scopeFilter as Ref<ScopeFilter>;

  /**
   * User-adjustable threshold (in days) for the "Expiring soon" filter. A file is "expiring
   * soon" iff at least one of its referencing runs has an `ExpiresAt` within this many days
   * from now AND the file is not marked Permanent. Persisted per-lab to localStorage so the
   * setting survives reloads but doesn't bleed across labs.
   */
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
  const expiringSoonThresholdDays = dc.expiringSoonThresholdDays;
  const tagsFilterUntagged = dc.tagsFilterUntagged;
  const tagsFilterTagIds = dc.tagsFilterTagIds;
  /** Per-template open/close state for the workflows left-rail accordion. */
  const expandedWorkflowTemplates = ref<Record<string, boolean>>({});
  /** Whether the long-list "Show more" toggle is open for the workflow templates. */
  const showAllWorkflowTemplates = ref(false);
  /** Left-rail Workflows / Tags blocks start expanded. */
  const tagsSectionExpanded = ref(true);
  const workflowsSectionExpanded = ref(true);
  const search = dc.search;
  const fileTypeFilterEnabled = dc.fileTypeFilterEnabled;

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

  const loading = dc.loading;

  /** True while a bulk tag apply/remove is running through API + listing refresh (for disabling panel actions). */
  const bulkPanelBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));

  const hasSelection = computed(() => selectedKeys.value.length > 0);

  const showRunWorkflowModal = ref(false);

  const canRunWorkflow = computed(
    () =>
      !!lab.value?.S3Bucket &&
      (!!lab.value?.AwsHealthOmicsEnabled ||
        (!!lab.value?.NextFlowTowerEnabled && !!lab.value?.HasNextFlowTowerAccessToken)),
  );

  function openRunWorkflowModal(): void {
    showRunWorkflowModal.value = true;
  }
  const bulkPanelOpen = computed(() => bulkPanelMode.value !== 'closed');

  const tagById = dc.tagById;
  const permanentTag = dc.permanentTag;
  const permanentTagId = dc.permanentTagId;
  const isFilePermanent = dc.isFilePermanent;
  const keyToWorkflowTagIdsEffective = dc.keyToWorkflowTagIdsEffective;
  const standardTagIdsForFileKey = dc.standardTagIdsForFileKey;
  const keyToStandardTagIdsForExplorer = dc.keyToStandardTagIdsForExplorer;
  const standardTags = dc.standardTags;

  /** Standard tags plus the system Permanent tag for the bulk add/remove tray only (left rail still omits Permanent). */
  const bulkPanelAssignableTags = computed(() => {
    const std = standardTags.value;
    const p = permanentTag.value;
    return p ? [...std, p] : std;
  });

  const batchTags = dc.batchTags;
  const workflowTags = dc.workflowTags;

  const workflowTemplates = dc.workflowTemplates;

  /**
   * Soft cap for the workflows left-rail before the "Show more" toggle kicks in. Picked to
   * roughly limit workflow rows before the Tags section in the same rail without excessive scrolling.
   */
  const WORKFLOW_TEMPLATE_COLLAPSED_LIMIT = 6;
  const visibleWorkflowTemplates = computed(() =>
    showAllWorkflowTemplates.value || workflowTemplates.value.length <= WORKFLOW_TEMPLATE_COLLAPSED_LIMIT
      ? workflowTemplates.value
      : workflowTemplates.value.slice(0, WORKFLOW_TEMPLATE_COLLAPSED_LIMIT),
  );

  /** True only when no scope filter and no Tags-section filters — matches fully unfiltered listing (aside from search). */
  function isScopeAllActive(): boolean {
    if (scopeFilter.value.kind !== 'all') return false;
    if (tagsFilterUntagged.value) return false;
    return tagsFilterTagIds.value.length === 0;
  }

  function isNotAnalyzedScopeActive(): boolean {
    return scopeFilter.value.kind === 'not-analyzed';
  }

  function isExpiringSoonScopeActive(): boolean {
    return scopeFilter.value.kind === 'expiring-soon';
  }

  function isWorkflowTemplateScopeActive(templateKey: string): boolean {
    const s = scopeFilter.value;
    return s.kind === 'workflow-template' && s.templateKey === templateKey;
  }

  function isWorkflowVersionScopeActive(tagId: string): boolean {
    const s = scopeFilter.value;
    return s.kind === 'workflow-version' && s.tagId === tagId;
  }

  function isUntaggedTagFilterActive(): boolean {
    return tagsFilterUntagged.value;
  }

  function isStandardTagFilterActive(tagId: string): boolean {
    return tagsFilterTagIds.value.includes(tagId);
  }

  function onAllSamplesScopeClick(): void {
    if (scopeFilter.value.kind === 'all') {
      tagsFilterUntagged.value = false;
      tagsFilterTagIds.value = [];
      return;
    }
    scopeFilter.value = { kind: 'all' };
  }

  function onNotYetAnalyzedScopeClick(): void {
    if (scopeFilter.value.kind === 'not-analyzed') {
      scopeFilter.value = { kind: 'all' };
      return;
    }
    scopeFilter.value = { kind: 'not-analyzed' };
  }

  function onExpiringSoonScopeClick(): void {
    if (scopeFilter.value.kind === 'expiring-soon') {
      scopeFilter.value = { kind: 'all' };
      return;
    }
    scopeFilter.value = { kind: 'expiring-soon' };
  }

  function onWorkflowTemplateScopeClick(templateKey: string): void {
    if (scopeFilter.value.kind === 'workflow-template' && scopeFilter.value.templateKey === templateKey) {
      scopeFilter.value = { kind: 'all' };
      return;
    }
    scopeFilter.value = { kind: 'workflow-template', templateKey };
  }

  function onWorkflowVersionScopeClick(tagId: string): void {
    if (scopeFilter.value.kind === 'workflow-version' && scopeFilter.value.tagId === tagId) {
      scopeFilter.value = { kind: 'all' };
      return;
    }
    scopeFilter.value = { kind: 'workflow-version', tagId };
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
    const pid = permanentTagId.value;
    for (const key of sel) {
      for (const tid of standardTagIdsForFileKey(key)) {
        counts.set(tid, (counts.get(tid) || 0) + 1);
      }
      if (pid && isFilePermanent(key)) {
        counts.set(pid, (counts.get(pid) || 0) + 1);
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

  /** Comma-separated unique batch names for the run-workflow modal (sorted). */
  const runModalAcrossBatchesSummary = computed(() => changeBatchCurrentlyInLine.value);

  /** Comma-separated unique standard/permanent tag names on the selection (sorted). */
  const runModalTagsPresentSummary = computed(() => {
    const names = tagsOnSelection.value.map((row) => tagById(row.tagId)?.Name ?? row.tagId);
    if (!names.length) return '—';
    return names.join(', ');
  });

  const runModalPreviouslyAnalyzedSummary = computed(() => {
    const total = selectedKeys.value.length;
    if (!total) return '—';
    const analyzed = selectedKeys.value.filter((key) => runCountForFileKey(key) > 0).length;
    return `${analyzed} of ${total}`;
  });

  const loadTags = dc.loadTags;
  const loadListing = dc.loadListing;
  const filesMatchingSearch = dc.filesMatchingSearch;
  const runCountForFileKey = dc.runCountForFileKey;
  const visibleFiles = dc.visibleFiles;
  const fileTypeCounts = dc.fileTypeCounts;
  const hiddenByFileTypeCount = dc.hiddenByFileTypeCount;
  const hiddenByFileTypeBreakdown = dc.hiddenByFileTypeBreakdown;
  const allSamplesChipCount = dc.allSamplesChipCount;
  const notAnalyzedChipCount = dc.notAnalyzedChipCount;
  const expiringSoonChipCount = dc.expiringSoonChipCount;
  const standardTagIdToChipCount = dc.standardTagIdToChipCount;
  const permanentTaggedFileCountInSearch = dc.permanentTaggedFileCountInSearch;
  const leftRailTagFilterTags = dc.leftRailTagFilterTags;
  const untaggedChipCount = dc.untaggedChipCount;

  watch(permanentTaggedFileCountInSearch, (n) => {
    const pid = permanentTagId.value;
    if (pid && n === 0 && tagsFilterTagIds.value.includes(pid)) {
      tagsFilterTagIds.value = tagsFilterTagIds.value.filter((id) => id !== pid);
    }
  });

  /** Explorer dismiss chips — ids must stay in sync with `clearExplorerFilter`. */
  const CHIP_SCOPE_NOT_ANALYZED = 'chip-scope-not-analyzed';
  const CHIP_SCOPE_EXPIRING_SOON = 'chip-scope-expiring-soon';
  const CHIP_TAG_UNTAGGED = 'chip-tag-untagged';

  function chipIdWorkflowTemplate(templateKey: string): string {
    return `chip-wft:${templateKey}`;
  }

  function chipIdWorkflowVersion(tagId: string): string {
    return `chip-wfv:${tagId}`;
  }

  function chipIdStandardTag(tagId: string): string {
    return `chip-tag:${tagId}`;
  }

  const explorerFilterChips = computed((): { chipId: string; label: string }[] => {
    const chips: { chipId: string; label: string }[] = [];
    const sf = scopeFilter.value;
    if (sf.kind === 'not-analyzed') {
      chips.push({ chipId: CHIP_SCOPE_NOT_ANALYZED, label: 'Not yet analyzed' });
    } else if (sf.kind === 'expiring-soon') {
      chips.push({
        chipId: CHIP_SCOPE_EXPIRING_SOON,
        label: `Expiring soon (≤ ${expiringSoonThresholdDays.value}d)`,
      });
    } else if (sf.kind === 'workflow-template') {
      const tmpl = workflowTemplates.value.find((t) => t.key === sf.templateKey);
      chips.push({
        chipId: chipIdWorkflowTemplate(sf.templateKey),
        label: tmpl?.name ?? sf.templateKey,
      });
    } else if (sf.kind === 'workflow-version') {
      const tag = tagById(sf.tagId);
      const versionLabel = tag?.WorkflowVersionName?.trim() ? tag.WorkflowVersionName.trim() : 'default';
      chips.push({
        chipId: chipIdWorkflowVersion(sf.tagId),
        label: tag ? `${tag.Name} (${versionLabel})` : sf.tagId,
      });
    }
    if (tagsFilterUntagged.value) {
      chips.push({ chipId: CHIP_TAG_UNTAGGED, label: 'Untagged' });
    }
    for (const tid of tagsFilterTagIds.value) {
      chips.push({ chipId: chipIdStandardTag(tid), label: tagById(tid)?.Name ?? tid });
    }
    return chips;
  });

  function clearExplorerFilter(chipId: string): void {
    if (chipId === CHIP_SCOPE_NOT_ANALYZED) {
      if (scopeFilter.value.kind === 'not-analyzed') scopeFilter.value = { kind: 'all' };
      return;
    }
    if (chipId === CHIP_SCOPE_EXPIRING_SOON) {
      if (scopeFilter.value.kind === 'expiring-soon') scopeFilter.value = { kind: 'all' };
      return;
    }
    if (chipId.startsWith('chip-wft:')) {
      const templateKey = chipId.slice('chip-wft:'.length);
      if (scopeFilter.value.kind === 'workflow-template' && scopeFilter.value.templateKey === templateKey) {
        scopeFilter.value = { kind: 'all' };
      }
      return;
    }
    if (chipId.startsWith('chip-wfv:')) {
      const wfTagId = chipId.slice('chip-wfv:'.length);
      if (scopeFilter.value.kind === 'workflow-version' && scopeFilter.value.tagId === wfTagId) {
        scopeFilter.value = { kind: 'all' };
      }
      return;
    }
    if (chipId === CHIP_TAG_UNTAGGED) {
      tagsFilterUntagged.value = false;
      return;
    }
    if (chipId.startsWith('chip-tag:')) {
      const tid = chipId.slice('chip-tag:'.length);
      tagsFilterTagIds.value = tagsFilterTagIds.value.filter((id: string) => id !== tid);
    }
  }

  const toggleKey = dc.toggleKey;
  const selectAllDisplayed = dc.selectAllDisplayed;
  const selectFilesForRun = dc.selectFilesForRun;

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

  const bulkPanelContentEl = ref<HTMLElement | null>(null);

  function scrollBulkPanelIntoView(): void {
    nextTick(() => {
      bulkPanelContentEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function openAddBulkPanel(): void {
    bulkPanelMode.value = 'add';
    resetBulkPanelDraft();
    scrollBulkPanelIntoView();
  }

  function openRemoveBulkPanel(): void {
    bulkPanelMode.value = 'remove';
    resetBulkPanelDraft();
    scrollBulkPanelIntoView();
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

  const addTagsToFilesInChunks = dc.addTagsToFilesInChunks;

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

  /** Shared create-tag API call + reload (used by bulk tray and left-rail create card). */
  async function createStandardTag(name: string, colorHex: string): Promise<{ TagId: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (exceedsTagNameMaxLength(name)) return null;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const created = await $api.dataCollections.createTag({
        LaboratoryId: props.labId,
        Name: trimmed,
        ColorHex: colorHex,
      });
      await loadTags();
      toast.success('Tag created');
      return created;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Create tag failed: ${msg}`);
      return null;
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function createTagInline(): Promise<void> {
    const created = await createStandardTag(inlineNewTagName.value, inlineNewTagColor.value);
    if (!created) return;
    bulkAddTagIds.value = [...new Set([...bulkAddTagIds.value, created.TagId])];
    showInlineCreateTag.value = false;
    inlineNewTagName.value = '';
    inlineNewTagColor.value = '#5B4FD4';
  }

  const showLeftRailCreateTag = ref(false);
  const leftRailNewTagName = ref('');
  const leftRailNewTagColor = ref('#5B4FD4');

  const leftRailTagNameInvalid = computed(() => exceedsTagNameMaxLength(leftRailNewTagName.value));
  const inlineTagNameInvalid = computed(() => exceedsTagNameMaxLength(inlineNewTagName.value));

  const canCreateLeftRailTag = computed(() => !!leftRailNewTagName.value.trim() && !leftRailTagNameInvalid.value);
  const canCreateInlineTag = computed(() => !!inlineNewTagName.value.trim() && !inlineTagNameInvalid.value);

  function cancelLeftRailCreateTag(): void {
    showLeftRailCreateTag.value = false;
    leftRailNewTagName.value = '';
    leftRailNewTagColor.value = '#5B4FD4';
  }

  async function createTagLeftRail(): Promise<void> {
    const created = await createStandardTag(leftRailNewTagName.value, leftRailNewTagColor.value);
    if (!created) return;
    cancelLeftRailCreateTag();
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
    const keysToTag = keys.filter((k) => !(keyToTagIds.value[k] ?? []).includes(tagId));
    if (!keysToTag.length) {
      toast.info(keys.length === 1 ? 'Tag already applied to that sample.' : 'Tag already applied to those samples.');
      return;
    }
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await addTagsToFilesInChunks(keysToTag, [tagId], []);
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

  /** While dragging files from the explorer onto a tag row, that tag id is highlighted. */
  const tagDropHighlightId = ref<string | null>(null);

  function dataTransferHasFileKeys(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    return [...dt.types].includes('application/x-eg-keys');
  }

  function onTagRowDragOver(e: DragEvent, tagId: string): void {
    if (!dataTransferHasFileKeys(e.dataTransfer)) return;
    e.preventDefault();
    tagDropHighlightId.value = tagId;
  }

  function onTagRowDragLeave(e: DragEvent, tagId: string): void {
    const cur = e.currentTarget as HTMLElement;
    const rel = e.relatedTarget as Node | null;
    if (rel && cur.contains(rel)) return;
    if (tagDropHighlightId.value === tagId) tagDropHighlightId.value = null;
  }

  function clearTagDropHighlight(): void {
    tagDropHighlightId.value = null;
  }

  function onTagRowDrop(e: DragEvent, tagId: string): void {
    clearTagDropHighlight();
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-eg-keys');
    if (!raw) return;
    const keys: string[] = JSON.parse(raw) as string[];
    void applyTagToKeys(tagId, keys);
  }

  const showChangeBatchModal = ref(false);
  const changeBatchSelectedBatchId = ref<string | undefined>(undefined);
  const changeBatchNewName = ref('');

  const changeBatchNewNameInvalid = computed(() => exceedsBatchNameMaxLength(changeBatchNewName.value));
  const canApplyChangeBatchWithNewName = computed(
    () => !!changeBatchNewName.value.trim() && !changeBatchNewNameInvalid.value,
  );
  const canApplyChangeBatch = computed(
    () =>
      canApplyChangeBatchWithNewName.value || (!!changeBatchSelectedBatchId.value && !changeBatchNewName.value.trim()),
  );

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
    if (nn && exceedsBatchNameMaxLength(changeBatchNewName.value)) return;
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
  <div v-else class="flex min-w-0 flex-col gap-0">
    <div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div class="flex h-[calc(100dvh-12rem)] min-h-0 flex-col overflow-hidden">
        <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <nav
            class="border-border-muted flex w-[280px] shrink-0 flex-col overflow-y-auto border-r bg-gray-50"
            aria-label="Sample filters"
          >
            <div class="border-border-muted border-b p-2">
              <button
                type="button"
                class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
                :class="{ 'bg-primary-muted font-medium': isScopeAllActive() }"
                @click="onAllSamplesScopeClick"
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
                :class="{ 'bg-primary-muted font-medium': isNotAnalyzedScopeActive() }"
                @click="onNotYetAnalyzedScopeClick"
              >
                <span>Not yet analyzed</span>
                <UBadge
                  size="xs"
                  class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
                >
                  {{ notAnalyzedChipCount }}
                </UBadge>
              </button>
              <button
                type="button"
                class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
                :class="{ 'bg-primary-muted font-medium': isExpiringSoonScopeActive() }"
                :title="`Files whose soonest run-retention ExpiresAt is within ${expiringSoonThresholdDays} days. Permanent files are excluded.`"
                @click="onExpiringSoonScopeClick"
              >
                <span class="flex items-center gap-2">
                  <UIcon name="i-heroicons-clock" class="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span>Expiring soon</span>
                </span>
                <UBadge
                  size="xs"
                  class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
                >
                  {{ expiringSoonChipCount }}
                </UBadge>
              </button>
              <div
                v-if="isExpiringSoonScopeActive()"
                class="text-muted mt-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs"
              >
                <label :for="`expiring-soon-days-${props.labId}`">Days ahead</label>
                <input
                  :id="`expiring-soon-days-${props.labId}`"
                  v-model.number="expiringSoonThresholdDays"
                  type="number"
                  :min="EXPIRING_SOON_MIN_DAYS"
                  :max="EXPIRING_SOON_MAX_DAYS"
                  step="1"
                  class="focus:border-primary focus-visible:ring-primary w-16 rounded border border-gray-300 px-2 py-1 text-right text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  @click.stop
                />
              </div>
            </div>

            <div class="border-border-muted border-b p-2">
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
                      'bg-primary-muted font-medium': isWorkflowTemplateScopeActive(tmpl.key),
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
                      @click="onWorkflowTemplateScopeClick(tmpl.key)"
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <span
                          class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          :style="{ background: tmpl.color }"
                        />
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
                        'bg-primary-muted font-medium': isWorkflowVersionScopeActive(v.tag.TagId),
                      }"
                      @click="onWorkflowVersionScopeClick(v.tag.TagId)"
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

            <div class="p-2">
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
                  class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
                  :class="{ 'bg-primary-muted font-medium': isUntaggedTagFilterActive() }"
                  @click="onUntaggedTagFilterClick"
                >
                  <span>Untagged</span>
                  <UBadge
                    size="xs"
                    class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
                  >
                    {{ untaggedChipCount }}
                  </UBadge>
                </button>
                <button
                  v-for="t in leftRailTagFilterTags"
                  :key="t.TagId"
                  class="hover:bg-primary-muted flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
                  :class="{
                    'bg-primary-muted font-medium': isStandardTagFilterActive(t.TagId),
                    'ring-primary ring-2 ring-inset': tagDropHighlightId === t.TagId,
                  }"
                  @click="onStandardTagFilterClick(t.TagId)"
                  @dragover="onTagRowDragOver($event, t.TagId)"
                  @dragleave="onTagRowDragLeave($event, t.TagId)"
                  @drop="onTagRowDrop($event, t.TagId)"
                >
                  <span class="flex min-w-0 flex-1 items-center gap-2">
                    <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
                    <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span class="truncate">{{ t.Name }}</span>
                      <span
                        v-if="(t.Kind ?? 'standard') === 'permanent'"
                        class="text-muted shrink-0 text-[10px] font-normal"
                      >
                        Protect from expiry
                      </span>
                    </span>
                  </span>
                  <UBadge
                    size="xs"
                    class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
                  >
                    {{
                      (t.Kind ?? 'standard') === 'permanent'
                        ? permanentTaggedFileCountInSearch
                        : (standardTagIdToChipCount[t.TagId] ?? 0)
                    }}
                  </UBadge>
                </button>

                <div class="border-border-muted mt-2 border-t pt-2">
                  <button
                    v-if="!showLeftRailCreateTag"
                    type="button"
                    class="text-primary hover:text-primary-dark px-2 py-1.5 text-left text-xs font-medium hover:underline"
                    @click="showLeftRailCreateTag = true"
                  >
                    + New Tag
                  </button>
                  <div v-else class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <div class="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Create Tag</div>
                    <div class="space-y-2">
                      <div>
                        <label class="text-muted mb-0.5 block text-xs font-medium">Tag name</label>
                        <UInput
                          v-model="leftRailNewTagName"
                          placeholder="Tag name"
                          size="sm"
                          :color="leftRailTagNameInvalid ? 'red' : undefined"
                        />
                        <p v-if="leftRailTagNameInvalid" class="text-alert-danger-dark mt-1 text-xs">
                          40 characters max
                        </p>
                      </div>
                      <div>
                        <label class="text-muted mb-0.5 block text-xs font-medium">Tag color</label>
                        <div class="flex flex-wrap gap-1">
                          <button
                            v-for="c in presetColors"
                            :key="'left-rail-preset-' + c"
                            type="button"
                            class="h-7 w-7 rounded border-2"
                            :class="leftRailNewTagColor === c ? 'border-primary' : 'border-transparent'"
                            :style="{ background: c }"
                            :aria-label="`Tag color ${c}`"
                            :aria-pressed="leftRailNewTagColor === c"
                            @click="leftRailNewTagColor = c"
                          />
                        </div>
                        <UInput v-model="leftRailNewTagColor" placeholder="#RRGGBB" size="sm" class="mt-1.5" />
                      </div>
                      <div class="flex gap-2 pt-1">
                        <UButton size="xs" variant="ghost" @click="cancelLeftRailCreateTag">Cancel</UButton>
                        <UButton
                          size="xs"
                          :disabled="!canCreateLeftRailTag"
                          :loading="loading"
                          @click="createTagLeftRail"
                        >
                          Create
                        </UButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </nav>

          <main class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Sample files">
            <EGDataCollectionsExplorer
              class="min-h-0 min-w-0 flex-1"
              :lab-id="props.labId"
              :lab-root="labRoot"
              :s3-bucket="lab?.S3Bucket"
              :visible-files="visibleFiles"
              :key-to-tag-ids="keyToStandardTagIdsForExplorer"
              :key-to-batch-tag-id="keyToBatchTagId"
              :key-to-workflow-tag-ids="keyToWorkflowTagIdsEffective"
              :key-to-run-usages="keyToRunUsages"
              :key-to-is-permanent="keyToIsPermanent"
              :batch-tags="batchTags"
              :tags="tags"
              :selected-keys="selectedKeys"
              :loading="loading"
              :search="search"
              :listing-file-count="files.length"
              :listing-truncated="listingTruncated"
              :filter-chips="explorerFilterChips"
              :file-type-filter="fileTypeFilterEnabled"
              :file-type-counts="fileTypeCounts"
              :hidden-by-file-type-count="hiddenByFileTypeCount"
              :hidden-by-file-type-breakdown="hiddenByFileTypeBreakdown"
              @update:search="search = $event"
              @update:file-type-filter="fileTypeFilterEnabled = $event"
              @update:selected-keys="selectedKeys = $event"
              @toggle-key="toggleKey"
              @select-all-displayed="selectAllDisplayed"
              @clear-selection="selectedKeys = []"
              @clear-filter="clearExplorerFilter($event)"
              @file-keys-drag-end="clearTagDropHighlight"
              @select-run-files="selectFilesForRun($event)"
            />
          </main>
        </div>

        <div class="border-border-muted shrink-0 border-t bg-gray-50" role="region" aria-label="Bulk tag actions">
          <div class="flex flex-wrap items-center gap-2 px-4 py-2">
            <span v-if="hasSelection" class="text-muted text-xs" aria-live="polite" aria-atomic="true">
              {{ selectedKeys.length }} file(s) selected
            </span>
            <span v-else class="text-muted text-xs">Select files in the grid to add or remove tags in bulk.</span>
            <div v-if="hasSelection" class="ml-auto flex flex-wrap items-center gap-2">
              <UIcon
                v-if="bulkPanelBusy"
                name="i-heroicons-arrow-path"
                class="text-muted h-5 w-5 shrink-0 animate-spin"
              />
              <UButton size="sm" variant="soft" :disabled="bulkPanelBusy" @click="openAddBulkPanel">Add Tags</UButton>
              <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openRemoveBulkPanel">
                Remove Tags
              </UButton>
              <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openChangeBatchModal">
                Change Batch
              </UButton>
              <UButton
                size="sm"
                icon="i-heroicons-play"
                :disabled="bulkPanelBusy || !canRunWorkflow"
                @click="openRunWorkflowModal"
              >
                Run workflow
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="bulkPanelOpen"
        ref="bulkPanelContentEl"
        class="border-border-muted relative border-t bg-white px-4 pb-4 pt-3"
        role="region"
        aria-label="Bulk tag editor"
      >
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
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    :style="{ background: tagById(row.tagId)?.ColorHex || '#ccc' }"
                  />
                  <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span class="truncate font-medium">{{ tagById(row.tagId)?.Name ?? row.tagId }}</span>
                    <span
                      v-if="tagById(row.tagId)?.Kind === 'permanent'"
                      class="text-muted shrink-0 text-[10px] font-normal"
                    >
                      Protect from expiry
                    </span>
                  </span>
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
                v-for="t in bulkPanelAssignableTags"
                :key="'add-' + t.TagId"
                class="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-gray-50"
              >
                <UCheckbox
                  :model-value="bulkAddTagIds.includes(t.TagId)"
                  @update:model-value="toggleBulkAddTag(t.TagId)"
                />
                <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
                <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span class="truncate">{{ t.Name }}</span>
                  <span
                    v-if="(t.Kind ?? 'standard') === 'permanent'"
                    class="text-muted shrink-0 text-[10px] font-normal"
                  >
                    Protect from expiry
                  </span>
                </span>
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
                <UInput
                  v-model="inlineNewTagName"
                  placeholder="Tag name"
                  size="sm"
                  :color="inlineTagNameInvalid ? 'red' : undefined"
                />
                <p v-if="inlineTagNameInvalid" class="text-alert-danger-dark text-xs">40 characters max</p>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="c in presetColors"
                    :key="c"
                    type="button"
                    class="h-7 w-7 rounded border-2"
                    :class="inlineNewTagColor === c ? 'border-primary' : 'border-transparent'"
                    :style="{ background: c }"
                    :aria-label="`Tag color ${c}`"
                    :aria-pressed="inlineNewTagColor === c"
                    @click="inlineNewTagColor = c"
                  />
                </div>
                <UInput v-model="inlineNewTagColor" placeholder="#RRGGBB" size="sm" />
                <div class="flex gap-2">
                  <UButton size="xs" variant="ghost" @click="showInlineCreateTag = false">Close</UButton>
                  <UButton size="xs" :disabled="!canCreateInlineTag" :loading="loading" @click="createTagInline">
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
                <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span class="truncate">{{ tagById(tid)?.Name ?? tid }}</span>
                  <span v-if="tagById(tid)?.Kind === 'permanent'" class="text-muted shrink-0 text-[10px] font-normal">
                    Protect from expiry
                  </span>
                </span>
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

    <EGRunFromCollectionsModal
      v-model="showRunWorkflowModal"
      :lab-id="labId"
      :lab="lab"
      :selected-keys="selectedKeys"
      :across-batches-summary="runModalAcrossBatchesSummary"
      :tags-present-summary="runModalTagsPresentSummary"
      :previously-analyzed-summary="runModalPreviouslyAnalyzedSummary"
      :listing-truncated="listingTruncated"
    />

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
              :color="changeBatchNewNameInvalid ? 'red' : undefined"
              :disabled="bulkPanelBusy || !!changeBatchSelectedBatchId"
            />
            <p v-if="changeBatchNewNameInvalid" class="text-alert-danger-dark mt-1 text-xs">250 characters max</p>
            <p v-else class="text-muted mt-1.5 text-xs leading-snug">
              Leave blank to use the existing batch selected above.
            </p>
          </div>
        </div>

        <div class="mt-8 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
          <UButton size="sm" variant="ghost" :disabled="bulkPanelBusy" @click="closeChangeBatchModal">Cancel</UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="clearBatchFromModal">
            Remove from batch
          </UButton>
          <UButton size="sm" :loading="bulkPanelBusy" :disabled="!canApplyChangeBatch" @click="applyChangeBatch">
            Move samples
          </UButton>
        </div>
      </UCard>
    </UModal>
  </div>
</template>
