<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type {
    LaboratoryDataTag,
    LaboratoryRunUsageSummary,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';
  import { isExpiringSoon } from '@FE/utils/data-collections-filters';

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
  /**
   * Whether each file carries the lab's system-managed permanent tag. Sourced from the
   * `IsPermanent` field on `FileTagAssignment` so the UI doesn't need to cross-reference
   * `tags.value` to know. Files marked Permanent are never auto-deleted by the run-retention
   * cleanup job and are excluded from the "Expiring soon" filter.
   */
  const keyToIsPermanent = ref<Record<string, boolean>>({});
  /**
   * Per-file laboratory run usage history, sorted newest first by `RunCreatedAt` (see
   * `listFileTags` on the back end). Drives the per-file Analysis History tooltip and the
   * orange/green/indigo status dot. Empty array means the file has never been used in a run.
   */
  const keyToRunUsages = ref<Record<string, LaboratoryRunUsageSummary[]>>({});
  const files = ref<{ Key: string; Size?: number; LastModified?: string }[]>([]);
  const listingTruncated = ref(false);
  const selectedKeys = ref<string[]>([]);

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

  const scopeFilter = ref<ScopeFilter>({ kind: 'all' });

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
  const expiringSoonThresholdDays = ref<number>(readPersistedExpiringSoonDays(props.labId));
  watch(expiringSoonThresholdDays, (next) => {
    if (typeof window === 'undefined') return;
    try {
      const clamped = Math.min(EXPIRING_SOON_MAX_DAYS, Math.max(EXPIRING_SOON_MIN_DAYS, Math.floor(Number(next) || 0)));
      if (clamped !== next) expiringSoonThresholdDays.value = clamped;
      window.localStorage?.setItem(`eg.dataCollections.${props.labId}.expiringSoonDays`, String(clamped));
    } catch {
      // localStorage unavailable (private mode, quota); state still lives in-memory.
    }
  });
  watch(
    () => props.labId,
    (next) => {
      expiringSoonThresholdDays.value = readPersistedExpiringSoonDays(next);
    },
  );
  /** Tags section: untagged is mutually exclusive with selecting specific standard tags. */
  const tagsFilterUntagged = ref(false);
  /** Multiple standard tags combine with OR (file matches if it has any selected tag). */
  const tagsFilterTagIds = ref<string[]>([]);
  /** Per-template open/close state for the workflows left-rail accordion. */
  const expandedWorkflowTemplates = ref<Record<string, boolean>>({});
  /** Whether the long-list "Show more" toggle is open for the workflow templates. */
  const showAllWorkflowTemplates = ref(false);
  /** Left-rail Workflows / Tags blocks start expanded. */
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

  /** Singleton permanent tag for this lab (lazy-created server-side on first listTags). */
  const permanentTag = computed<LaboratoryDataTag | undefined>(() => tags.value.find((t) => t.Kind === 'permanent'));
  const permanentTagId = computed<string | undefined>(() => permanentTag.value?.TagId);

  function isFilePermanent(key: string): boolean {
    if (keyToIsPermanent.value[key]) return true;
    const pid = permanentTagId.value;
    if (!pid) return false;
    // Fall back to the raw TagIds list when `IsPermanent` was missing from the API payload
    // (defensive — older list-file-tags responses may not project the field).
    return (keyToTagIds.value[key] || []).includes(pid);
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
   * chips in the standard row. The permanent tag is rendered as a dedicated lock affordance
   * elsewhere and is also excluded from this list.
   */
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

  /** Standard tags plus the system Permanent tag for the bulk add/remove tray only (left rail still omits Permanent). */
  const bulkPanelAssignableTags = computed(() => {
    const std = standardTags.value;
    const p = permanentTag.value;
    return p ? [...std, p] : std;
  });

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
            LaboratoryId: props.labId,
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

  /** Number of laboratory runs that have used the given file as input. */
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

  const visibleFiles = computed(() => {
    let list = filesMatchingSearch.value;
    const sf = scopeFilter.value;
    switch (sf.kind) {
      case 'all':
        break;
      case 'not-analyzed':
        // Run-history-based: a file is "not yet analyzed" iff it has zero recorded run usages.
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

  /** Count for "All samples" chip — all loaded files matching search (same universe as no filter). */
  const allSamplesChipCount = computed(() => filesMatchingSearch.value.length);

  const notAnalyzedChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => runCountForFileKey(f.Key) === 0).length,
  );

  const expiringSoonChipCount = computed(
    () => filesMatchingSearch.value.filter((f) => isFileExpiringSoon(f.Key)).length,
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

  /** Listed files (current search scope) that carry the Permanent tag — drives left-rail Permanent filter visibility. */
  const permanentTaggedFileCountInSearch = computed(
    () => filesMatchingSearch.value.filter((f) => isFilePermanent(f.Key)).length,
  );

  /**
   * Left-rail tag filters: all standard tags, plus Permanent only when at least one file in the
   * current listing/search has it (same universe as chip counts).
   */
  const leftRailTagFilterTags = computed(() => {
    const std = standardTags.value;
    const p = permanentTag.value;
    if (!p || permanentTaggedFileCountInSearch.value === 0) return std;
    return [...std, p];
  });

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

  function toggleKey(key: string): void {
    const s = new Set(selectedKeys.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    selectedKeys.value = [...s];
  }

  function selectAllDisplayed(): void {
    selectedKeys.value = visibleFiles.value.map((f) => f.Key);
  }

  /**
   * Replace the current selection with the input file keys recorded for a given run, restricted
   * to keys that are present in the loaded listing. Keys not currently visible (e.g. deleted from
   * S3 since the run, or outside this listing's page) are silently dropped so we never select
   * ghost rows.
   */
  function selectFilesForRun(payload: { runId: string; inputFileKeys: string[] }): void {
    const loadedKeys = new Set(files.value.map((f) => f.Key));
    selectedKeys.value = payload.inputFileKeys.filter((k) => loadedKeys.has(k));
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

  /** Shared create-tag API call + reload (used by bulk tray and left-rail create card). */
  async function createStandardTag(name: string, colorHex: string): Promise<{ TagId: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
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
              class="focus:border-primary w-16 rounded border border-gray-300 px-2 py-1 text-right text-xs tabular-nums focus:outline-none"
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
              class="hover:bg-primary-muted flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm"
              :class="{ 'bg-primary-muted font-medium': isUntaggedTagFilterActive() }"
              @click="onUntaggedTagFilterClick"
            >
              <span>Untagged</span>
            </button>
            <button
              v-for="t in leftRailTagFilterTags"
              :key="t.TagId"
              class="hover:bg-primary-muted flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
              :class="{ 'bg-primary-muted font-medium': isStandardTagFilterActive(t.TagId) }"
              @click="onStandardTagFilterClick(t.TagId)"
              @dragover.prevent="onCardDragOverTag"
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
                    <UInput v-model="leftRailNewTagName" placeholder="Tag name" size="sm" />
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
                        @click="leftRailNewTagColor = c"
                      />
                    </div>
                    <UInput v-model="leftRailNewTagColor" placeholder="#RRGGBB" size="sm" class="mt-1.5" />
                  </div>
                  <div class="flex gap-2 pt-1">
                    <UButton size="xs" variant="ghost" @click="cancelLeftRailCreateTag">Cancel</UButton>
                    <UButton
                      size="xs"
                      :disabled="!leftRailNewTagName.trim()"
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
      </div>

      <EGDataCollectionsExplorer
        class="min-h-0 min-w-0 flex-1"
        :lab-id="props.labId"
        :lab-root="labRoot"
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
        @update:search="search = $event"
        @update:selected-keys="selectedKeys = $event"
        @toggle-key="toggleKey"
        @select-all-displayed="selectAllDisplayed"
        @clear-selection="selectedKeys = []"
        @clear-filter="clearExplorerFilter($event)"
        @remove-tag-from-file="removeTagFromFile($event.key, $event.tagId)"
        @select-run-files="selectFilesForRun($event)"
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

      <div
        v-if="bulkPanelOpen"
        ref="bulkPanelContentEl"
        class="border-border-muted relative border-t bg-white px-4 pb-4 pt-3"
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
