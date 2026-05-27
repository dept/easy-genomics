<script setup lang="ts">
  /**
   * File grid, folder shortcuts, lasso selection, and drag/drop targets for tagging.
   * Parent (EGDataCollectionsPage) owns data fetching and tag sidebar.
   */
  import type {
    LaboratoryDataTag,
    LaboratoryRunUsageSummary,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type {
    DataCollectionFileKind,
    DataCollectionFileTypeFilter,
    HiddenFileTypeBreakdownRow,
  } from '@FE/utils/data-collections-file-type';
  import { dataCollectionFileKind } from '@FE/utils/data-collections-file-type';
  import { formatFileSize } from '@FE/utils/file-size';
  import { getReadDirection, getSampleGroupId } from '@FE/utils/data-collections-to-sample-sheet';

  const props = defineProps<{
    /** Used to deep-link from the analysis history tooltip to a laboratory run detail page. */
    labId: string;
    /** When set, path tooltips use `s3://bucket/key` instead of the raw key only. */
    s3Bucket?: string;
    labRoot: string;
    visibleFiles: { Key: string; Size?: number; LastModified?: string }[];
    keyToTagIds: Record<string, string[]>;
    /** Batch tag id per file key (optional until parent loads assignments). */
    keyToBatchTagId?: Record<string, string | undefined>;
    /**
     * Workflow tag ids per file key (optional until parent loads assignments). Used to drive
     * the per-file Analyzed / Not yet analyzed status without an extra round-trip.
     */
    keyToWorkflowTagIds?: Record<string, string[]>;
    /**
     * Per-file laboratory run usage history (sorted newest first). Drives the status pill
     * (Not yet analyzed / Analyzed / Analyzed Nx) and the analysis history tooltip.
     */
    keyToRunUsages?: Record<string, LaboratoryRunUsageSummary[]>;
    /**
     * Per-file flag indicating the lab's system-managed Permanent tag is applied. Rendered as
     * a dedicated red lock affordance on each card / table row; never appears in the standard
     * tag pill rail.
     */
    keyToIsPermanent?: Record<string, boolean>;
    batchTags?: LaboratoryDataTag[];
    tags: LaboratoryDataTag[];
    selectedKeys: string[];
    loading: boolean;
    search: string;
    /** Files returned for the current S3 prefix (before search / tag filters in the parent). */
    listingFileCount: number;
    /** Recursive listing stopped at MaxTotalKeys; more objects exist in S3. */
    listingTruncated?: boolean;
    /** Active filter chips (scope + tags); each chip can be dismissed independently in the explorer header. */
    filterChips?: { chipId: string; label: string }[];
    fileTypeFilter: DataCollectionFileTypeFilter;
    fileTypeCounts: { fastq: number; fasta: number; other: number };
    hiddenByFileTypeCount: number;
    hiddenByFileTypeBreakdown: HiddenFileTypeBreakdownRow[];
  }>();

  const emit = defineEmits<{
    'update:search': [v: string];
    'update:fileTypeFilter': [value: DataCollectionFileTypeFilter];
    'update:selectedKeys': [keys: string[]];
    selectAllDisplayed: [];
    clearSelection: [];
    clearFilter: [chipId: string];
    /** Fired when a file-card drag ends (including cancel) so parents can clear drop-target UI. */
    fileKeysDragEnd: [];
    /** Tooltip emits this when the user clicks the check button on a run row. */
    selectRunFiles: [payload: { runId: string; inputFileKeys: string[] }];
  }>();

  const filterChipsResolved = computed(() => props.filterChips ?? []);

  /** Cards grid vs tabular explorer layout. */
  const explorerView = ref<'cards' | 'table'>('cards');

  const fileTypeFilterOpen = ref(false);

  function onOpenFileTypeFilterFromHiddenChip(): void {
    nextTick(() => {
      fileTypeFilterOpen.value = true;
    });
  }

  const scrollEl = ref<HTMLElement | null>(null);
  const lassoActive = ref(false);
  const lassoStyle = ref({
    display: 'none' as string,
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
  });
  let lx0 = 0;
  let ly0 = 0;

  /** While a file’s analysis popover is open, that card/row is stacked above siblings so other files’ dots do not show through the panel. */
  const analysisPopoverOpenKey = ref<string | null>(null);

  function onAnalysisPopoverOpen(fileKey: string, open: boolean): void {
    if (open) {
      analysisPopoverOpenKey.value = fileKey;
    } else if (analysisPopoverOpenKey.value === fileKey) {
      analysisPopoverOpenKey.value = null;
    }
  }

  function tagById(id: string): LaboratoryDataTag | undefined {
    return props.tags.find((t: LaboratoryDataTag) => t.TagId === id);
  }

  function pillTextColor(bgHex: string): string {
    const h = bgHex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 150 ? '#1a1a2e' : '#ffffff';
  }

  function fileName(key: string): string {
    const parts = key.split('/').filter(Boolean);
    return parts[parts.length - 1] || key;
  }

  function isFilePermanent(key: string): boolean {
    return !!(props.keyToIsPermanent && props.keyToIsPermanent[key]);
  }

  /**
   * Soonest run-retention expiry (epoch seconds) recorded against the file, or undefined if
   * no usages carry an `ExpiresAt`. Used by the table view's Expires column.
   */
  function soonestRunExpiresAt(key: string): number | undefined {
    const usages = props.keyToRunUsages?.[key];
    if (!usages || !usages.length) return undefined;
    let soonest: number | undefined;
    for (const u of usages) {
      if (typeof u.ExpiresAt === 'number' && (soonest === undefined || u.ExpiresAt < soonest)) {
        soonest = u.ExpiresAt;
      }
    }
    return soonest;
  }

  function formatExpiresLabel(key: string): string {
    if (isFilePermanent(key)) return 'Never';
    const epoch = soonestRunExpiresAt(key);
    if (epoch === undefined) return '—';
    const now = Math.floor(Date.now() / 1000);
    const diffDays = Math.round((epoch - now) / 86400);
    if (diffDays <= 0) return 'Expired';
    if (diffDays === 1) return 'in 1 day';
    if (diffDays < 30) return `in ${diffDays} days`;
    const months = Math.round(diffDays / 30);
    return months <= 1 ? 'in ~1 month' : `in ~${months} months`;
  }

  /** Full object location for hover tooltips (truncated paths in the grid). */
  function s3ObjectTooltip(key: string): string {
    const b = props.s3Bucket?.trim();
    if (b) return `s3://${b}/${key}`;
    return key;
  }

  /** Folder path under the lab root (for flat recursive listings). */
  function folderPathUnderLab(key: string): string {
    const root = props.labRoot;
    if (!key.startsWith(root)) return '';
    const tail = key.slice(root.length);
    const parts = tail.split('/').filter(Boolean);
    if (parts.length <= 1) return '';
    parts.pop();
    return `${parts.join('/')}/`;
  }

  /** Number of laboratory runs that have used the given file as input. */
  function runCountForFileKey(key: string): number {
    return props.keyToRunUsages?.[key]?.length ?? 0;
  }

  function runUsagesForFileKey(key: string): LaboratoryRunUsageSummary[] {
    return props.keyToRunUsages?.[key] ?? [];
  }

  /**
   * Standard tag names (excludes batch + workflow tags) for the analysis history tooltip
   * subtitle. The parent already filters its `keyToTagIds` prop down to standard tags only, so
   * this just resolves ids to display names while preserving order.
   */
  /** Standard tag ids for this file (parent passes standard tags only). */
  function standardTagIdsForFileKey(key: string): string[] {
    return props.keyToTagIds[key] ?? [];
  }

  function standardTagNamesForFileKey(key: string): string[] {
    const ids: string[] = standardTagIdsForFileKey(key);
    return ids.map((id: string) => tagById(id)?.Name ?? id).filter((n: string) => !!n);
  }

  /** No file objects returned for this listing (under lab prefix). */
  const noObjectsUnderLabPrefix = computed(() => !props.loading && props.listingFileCount === 0);
  const allFilesHiddenByFilters = computed(
    () => !props.loading && props.listingFileCount > 0 && props.visibleFiles.length === 0,
  );

  const visibleSampleNoun = computed(() => (visibleDisplayGroupCount.value === 1 ? 'sample' : 'samples'));

  const batchTagsResolved = computed(() => props.batchTags ?? []);

  const keyToBatchResolved = computed(() => props.keyToBatchTagId ?? {});

  type BatchSectionHeaderParts = {
    /** Batch display name (tag name); for unbatched rows this is `Unbatched`. */
    titleBold: string;
    sampleCount: number;
    sampleNoun: string;
    notYetAnalyzed: number;
    analyzed: number;
  };

  const BATCH_HEADER_DOT_NOT_ANALYZED = '#EF9F27';
  const BATCH_HEADER_DOT_ANALYZED = '#2DB48F';

  /**
   * Nuxt UI v2 tooltip theme defaults: `max-w-xs`, fixed `h-6`, and `truncate` on the content box
   * (see `node_modules/@nuxt/ui/dist/runtime/ui.config/overlays/tooltip.js`). That clips long S3
   * URIs; widen the popper and allow wrapped multi-line text with vertical scroll if needed.
   */
  const s3PathTooltipUi = {
    /** Default `inline-flex` keeps min-content width — long filenames overflow the card grid cell. */
    wrapper: 'relative block w-full min-w-0 max-w-full',
    width: 'max-w-[min(92vw,52rem)]',
    base: '[@media(pointer:coarse)]:hidden min-h-0 h-auto max-h-[min(80vh,32rem)] overflow-y-auto overflow-x-hidden px-2.5 py-2 text-xs font-normal whitespace-normal break-all text-left relative',
  };

  /**
   * Display unit in the explorer grid / table. Multi-lane paired reads sharing a sample id
   * (matched by `getSampleGroupId`) collapse into one group; everything else is a solo group
   * keyed by its raw S3 Key.
   */
  type DisplayGroup = {
    /** Stable group id — folder + sampleId for grouped reads, raw S3 key for solos. */
    groupId: string;
    /** Every S3 key in the group (1 for solos, ≥2 for paired-read groups). */
    keys: string[];
    files: { Key: string; Size?: number; LastModified?: string }[];
    /** First key (key-sorted). Used for popover open-tracking, folder path, drag preview. */
    primaryKey: string;
    fileCount: number;
    /** Display label: sampleId for grouped reads, basename for solos. */
    label: string;
    isGroup: boolean;
  };

  /** Folder portion of an S3 key (with trailing slash); '' for root-level keys. */
  function folderPrefix(key: string): string {
    const i = key.lastIndexOf('/');
    return i >= 0 ? key.slice(0, i + 1) : '';
  }

  /**
   * Group paired reads sharing a sample id within the same S3 folder. Non-paired files
   * (txt, html, fasta, index reads, etc.) become solo groups.
   */
  function buildDisplayGroups(files: { Key: string; Size?: number; LastModified?: string }[]): DisplayGroup[] {
    const groups = new Map<string, { sampleId: string; files: typeof files }>();
    const solos: typeof files = [];
    for (const f of files) {
      const sampleId = getSampleGroupId(fileName(f.Key));
      if (sampleId === null) {
        solos.push(f);
        continue;
      }
      const groupKey = folderPrefix(f.Key) + ' ' + sampleId;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.files.push(f);
      } else {
        groups.set(groupKey, { sampleId, files: [f] });
      }
    }
    const result: DisplayGroup[] = [];
    for (const [groupKey, { sampleId, files: gFiles }] of groups) {
      const sorted = [...gFiles].sort((a, b) => a.Key.localeCompare(b.Key));
      const keys = sorted.map((f) => f.Key);
      result.push({
        groupId: groupKey,
        keys,
        files: sorted,
        primaryKey: keys[0],
        fileCount: keys.length,
        label: sampleId,
        isGroup: keys.length > 1,
      });
    }
    for (const f of solos) {
      result.push({
        groupId: f.Key,
        keys: [f.Key],
        files: [f],
        primaryKey: f.Key,
        fileCount: 1,
        label: fileName(f.Key),
        isGroup: false,
      });
    }
    return result;
  }

  function isGroupSelected(g: DisplayGroup): boolean {
    return g.keys.every((k) => props.selectedKeys.includes(k));
  }

  function isGroupPartiallySelected(g: DisplayGroup): boolean {
    const sel = new Set(props.selectedKeys);
    let some = false;
    let all = true;
    for (const k of g.keys) {
      if (sel.has(k)) some = true;
      else all = false;
    }
    return some && !all;
  }

  /** Atomic toggle: deselect all keys in the group if all are selected, otherwise add them all. */
  function onGroupToggle(g: DisplayGroup): void {
    const s = new Set(props.selectedKeys);
    if (g.keys.every((k) => s.has(k))) {
      for (const k of g.keys) s.delete(k);
    } else {
      for (const k of g.keys) s.add(k);
    }
    emit('update:selectedKeys', [...s]);
  }

  /** Run usages across every key in the group, deduped by RunId, sorted newest first. */
  function groupRunUsages(g: DisplayGroup): LaboratoryRunUsageSummary[] {
    const seen = new Set<string>();
    const merged: LaboratoryRunUsageSummary[] = [];
    for (const k of g.keys) {
      const usages = props.keyToRunUsages?.[k] ?? [];
      for (const u of usages) {
        if (!seen.has(u.RunId)) {
          seen.add(u.RunId);
          merged.push(u);
        }
      }
    }
    merged.sort((a, b) => (b.RunCreatedAt || '').localeCompare(a.RunCreatedAt || ''));
    return merged;
  }

  function groupHasAnyRunUsage(g: DisplayGroup): boolean {
    for (const k of g.keys) {
      if ((props.keyToRunUsages?.[k]?.length ?? 0) > 0) return true;
    }
    return false;
  }

  /** Union of standard tag ids across all keys in the group, dedup-by-first-seen. */
  function groupStandardTagIds(g: DisplayGroup): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const k of g.keys) {
      for (const tid of props.keyToTagIds[k] ?? []) {
        if (!seen.has(tid)) {
          seen.add(tid);
          result.push(tid);
        }
      }
    }
    return result;
  }

  function groupStandardTagNames(g: DisplayGroup): string[] {
    return groupStandardTagIds(g)
      .map((id: string) => tagById(id)?.Name ?? id)
      .filter((n: string) => !!n);
  }

  /** True when the group contains at least one R1 and one R2 file (a true paired-end sample). */
  function isGroupPaired(g: DisplayGroup): boolean {
    if (!g.isGroup) return false;
    let hasR1 = false;
    let hasR2 = false;
    for (const f of g.files) {
      const dir = getReadDirection(fileName(f.Key));
      if (dir === 'R1') hasR1 = true;
      else if (dir === 'R2') hasR2 = true;
      if (hasR1 && hasR2) return true;
    }
    return false;
  }

  function isGroupAllPermanent(g: DisplayGroup): boolean {
    return g.keys.every((k) => isFilePermanent(k));
  }

  function isGroupAnyPermanent(g: DisplayGroup): boolean {
    return g.keys.some((k) => isFilePermanent(k));
  }

  function groupBatchId(g: DisplayGroup): string | undefined {
    const primary = keyToBatchResolved.value[g.primaryKey];
    if (primary) return primary;
    for (const k of g.keys) {
      const b = keyToBatchResolved.value[k];
      if (b) return b;
    }
    return undefined;
  }

  function groupBatchName(g: DisplayGroup): string {
    const bid = groupBatchId(g);
    if (!bid) return '—';
    const tag = batchTagsResolved.value.find((b: LaboratoryDataTag) => b.TagId === bid);
    return tag?.Name ?? bid;
  }

  /** Earliest expiry across the group's run usages, or undefined when no usages have one. */
  function groupSoonestExpiresAt(g: DisplayGroup): number | undefined {
    let soonest: number | undefined;
    for (const k of g.keys) {
      const usages = props.keyToRunUsages?.[k] ?? [];
      for (const u of usages) {
        if (typeof u.ExpiresAt === 'number' && (soonest === undefined || u.ExpiresAt < soonest)) {
          soonest = u.ExpiresAt;
        }
      }
    }
    return soonest;
  }

  function groupExpiresLabel(g: DisplayGroup): string {
    if (isGroupAllPermanent(g)) return 'Never';
    const epoch = groupSoonestExpiresAt(g);
    if (epoch === undefined) return '—';
    const now = Math.floor(Date.now() / 1000);
    const diffDays = Math.round((epoch - now) / 86400);
    if (diffDays <= 0) return 'Expired';
    if (diffDays === 1) return 'in 1 day';
    if (diffDays < 30) return `in ${diffDays} days`;
    const months = Math.round(diffDays / 30);
    return months <= 1 ? 'in ~1 month' : `in ~${months} months`;
  }

  /** Payload for the analysis tooltip's "Files (N)" section. */
  function groupFilesForPopover(
    g: DisplayGroup,
  ): { Key: string; fileName: string; size?: number; fileKind: DataCollectionFileKind }[] {
    return g.files.map((f) => ({
      Key: f.Key,
      fileName: fileName(f.Key),
      size: f.Size,
      fileKind: dataCollectionFileKind(f.Key),
    }));
  }

  function batchSectionHeaderParts(sec: {
    batchId: string | null;
    title: string;
    groups: readonly DisplayGroup[];
  }): BatchSectionHeaderParts {
    const n = sec.groups.length;
    const sampleNoun = n === 1 ? 'sample' : 'samples';
    const titleBold = sec.title;
    let notYetAnalyzed = 0;
    let analyzed = 0;
    for (const g of sec.groups) {
      if (groupHasAnyRunUsage(g)) analyzed += 1;
      else notYetAnalyzed += 1;
    }
    return {
      titleBold,
      sampleCount: n,
      sampleNoun,
      notYetAnalyzed,
      analyzed,
    };
  }

  /** Group visible files by batch, then collapse paired reads into DisplayGroups per section. */
  const fileSections = computed(() => {
    type Row = (typeof props.visibleFiles)[number];
    const nameById = new Map<string, string>(
      batchTagsResolved.value.map((t: LaboratoryDataTag) => [t.TagId, t.Name] as [string, string]),
    );
    const byBatch = new Map<string | null, Row[]>();
    for (const f of props.visibleFiles) {
      const bid = keyToBatchResolved.value[f.Key] ?? null;
      if (!byBatch.has(bid)) byBatch.set(bid, []);
      byBatch.get(bid)!.push(f);
    }
    const batchEntries = [...byBatch.entries()].filter(([k]) => k !== null) as [string, Row[]][];
    batchEntries.sort((a, b) => {
      const na = nameById.get(a[0]) ?? a[0];
      const nb = nameById.get(b[0]) ?? b[0];
      return na.localeCompare(nb);
    });
    const sections: { batchId: string | null; title: string; files: Row[]; groups: DisplayGroup[] }[] = [];
    const unbatched = byBatch.get(null);
    if (unbatched?.length) {
      sections.push({ batchId: null, title: 'Unbatched', files: unbatched, groups: buildDisplayGroups(unbatched) });
    }
    for (const [bid, files] of batchEntries) {
      sections.push({
        batchId: bid,
        title: nameById.get(bid) ?? bid,
        files,
        groups: buildDisplayGroups(files),
      });
    }
    return sections.map((sec) => ({
      ...sec,
      headerParts: batchSectionHeaderParts(sec),
    }));
  });

  /** Total display-group count across all sections — used for the "X samples" header counter. */
  const visibleDisplayGroupCount = computed(() => fileSections.value.reduce((n, sec) => n + sec.groups.length, 0));

  function batchDisplayName(key: string): string {
    const bid = keyToBatchResolved.value[key];
    if (!bid) return '—';
    const tag = batchTagsResolved.value.find((b: LaboratoryDataTag) => b.TagId === bid);
    return tag?.Name ?? bid;
  }

  function batchSectionFullySelected(sec: { files: readonly { Key: string }[] }): boolean {
    if (!sec.files.length) return false;
    return sec.files.every((f) => props.selectedKeys.includes(f.Key));
  }

  /** Selects all files in the section, or clears them from the selection if already fully selected. */
  function toggleBatchSection(sec: { files: readonly { Key: string }[] }): void {
    const keys = sec.files.map((f) => f.Key);
    if (batchSectionFullySelected(sec)) {
      const remove = new Set(keys);
      emit(
        'update:selectedKeys',
        props.selectedKeys.filter((k: string) => !remove.has(k)),
      );
    } else {
      const merged = new Set(props.selectedKeys);
      keys.forEach((k) => merged.add(k));
      emit('update:selectedKeys', [...merged]);
    }
  }

  function onScrollHostMouseDown(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('[data-file-card]')) return;
    if (e.button !== 0) return;
    lassoActive.value = true;
    lx0 = e.clientX;
    ly0 = e.clientY;
    lassoStyle.value = {
      display: 'block',
      left: `${lx0}px`,
      top: `${ly0}px`,
      width: '0px',
      height: '0px',
    };
    e.preventDefault();
  }

  function onWindowMouseMove(e: MouseEvent): void {
    if (!lassoActive.value) return;
    const x = Math.min(e.clientX, lx0);
    const y = Math.min(e.clientY, ly0);
    const w = Math.abs(e.clientX - lx0);
    const h = Math.abs(e.clientY - ly0);
    lassoStyle.value = { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` };
    const lr = { left: x, top: y, right: x + w, bottom: y + h };
    scrollEl.value?.querySelectorAll('[data-file-card]').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const hit = r.left < lr.right && r.right > lr.left && r.top < lr.bottom && r.bottom > lr.top;
      /** Lasso-only class — never strip Vue-bound `ring-*` on selected cards (Vue may not re-patch if props unchanged). */
      (el as HTMLElement).classList.toggle('eg-data-collections-lasso-hit', hit);
    });
  }

  function onWindowMouseUp(): void {
    if (!lassoActive.value) return;
    lassoActive.value = false;
    lassoStyle.value = { ...lassoStyle.value, display: 'none' };
    const added: string[] = [];
    scrollEl.value?.querySelectorAll('[data-file-card]').forEach((el) => {
      const h = el as HTMLElement;
      if (h.classList.contains('eg-data-collections-lasso-hit')) {
        // Each card carries every key in its display group (space-separated) so a single
        // DOM hit pulls all paired-read files into the selection at once.
        const raw = h.dataset.keys ?? h.dataset.key ?? '';
        for (const k of raw.split(' ')) {
          if (k) added.push(k);
        }
      }
      h.classList.remove('eg-data-collections-lasso-hit');
    });
    if (added.length) {
      const s = new Set(props.selectedKeys);
      added.forEach((k) => s.add(k));
      emit('update:selectedKeys', [...s]);
    }
  }

  onMounted(() => {
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
  });

  function onCardDragStart(e: DragEvent, group: DisplayGroup): void {
    // If the dragged group is fully selected, drag the whole current selection (existing
    // multi-select behavior); otherwise drag exactly the keys in this group.
    const groupSelected = group.keys.every((k) => props.selectedKeys.includes(k));
    const keys = groupSelected ? [...props.selectedKeys] : [...group.keys];
    e.dataTransfer?.setData('application/x-eg-keys', JSON.stringify(keys));
    e.dataTransfer?.setData('text/plain', 'keys');
  }

  function onFileCardDragEnd(): void {
    emit('fileKeysDragEnd');
  }
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <motion.div class="border-border-muted flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <UInput
        :model-value="search"
        placeholder="Search file names…"
        class="max-w-xs"
        size="sm"
        @update:model-value="emit('update:search', $event)"
      />
      <div class="border-border-muted flex shrink-0 rounded-lg border p-0.5">
        <UButton
          size="xs"
          square
          icon="i-heroicons-squares-2x2"
          :variant="explorerView === 'cards' ? 'soft' : 'ghost'"
          class="rounded-md"
          aria-label="Card view"
          @click="explorerView = 'cards'"
        />
        <UButton
          size="xs"
          square
          icon="i-heroicons-list-bullet"
          :variant="explorerView === 'table' ? 'soft' : 'ghost'"
          class="rounded-md"
          aria-label="Table view"
          @click="explorerView = 'table'"
        />
      </div>
      <div class="ml-auto shrink-0">
        <EGDataCollectionsFileTypeFilter
          v-model:open="fileTypeFilterOpen"
          :model-value="fileTypeFilter"
          :counts="fileTypeCounts"
          @update:model-value="emit('update:fileTypeFilter', $event)"
        />
      </div>
    </motion.div>
    <div class="border-border-muted flex flex-wrap items-center gap-2 border-b bg-gray-50 px-4 py-2">
      <span class="text-xs font-semibold leading-snug text-gray-900">
        {{ visibleDisplayGroupCount }} {{ visibleSampleNoun }}
      </span>
      <motion.div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <EGDataCollectionsHiddenFileTypesPopover
          v-if="hiddenByFileTypeCount > 0"
          :hidden-count="hiddenByFileTypeCount"
          :breakdown="hiddenByFileTypeBreakdown"
          @open-file-type-filter="onOpenFileTypeFilterFromHiddenChip"
        />
        <div
          v-for="chip in filterChipsResolved"
          :key="chip.chipId"
          class="bg-primary-muted text-primary-dark inline-flex max-w-full items-center gap-0.5 rounded-full border border-transparent py-0.5 pl-2 pr-0.5 text-xs font-medium"
        >
          <span class="min-w-0 max-w-[min(14rem,100%)] truncate">{{ chip.label }}</span>
          <UButton
            size="xs"
            square
            variant="ghost"
            icon="i-heroicons-x-mark"
            class="text-primary-dark shrink-0 rounded-full"
            :aria-label="`Clear filter: ${chip.label}`"
            @click="emit('clearFilter', chip.chipId)"
          />
        </div>
      </motion.div>
      <div class="ml-auto flex shrink-0">
        <UButton v-if="selectedKeys.length" size="xs" variant="ghost" @click="emit('clearSelection')">
          Deselect all ({{ selectedKeys.length }})
        </UButton>
        <UButton
          v-else
          size="xs"
          variant="ghost"
          :disabled="!visibleFiles.length || loading"
          @click="emit('selectAllDisplayed')"
        >
          Select all ({{ visibleDisplayGroupCount }})
        </UButton>
      </div>
    </div>
    <div v-if="listingTruncated" class="border-border-muted border-b bg-amber-50 px-4 py-2 text-xs text-amber-950">
      More objects exist under this prefix than are loaded here. Showing {{ listingFileCount }} file(s); the server
      stops at a safety limit for very large buckets. Use search and tags to work with this subset, or ask for a higher
      listing limit.
    </div>

    <div ref="scrollEl" class="relative min-h-0 flex-1 overflow-auto p-2" @mousedown="onScrollHostMouseDown">
      <div
        v-if="loading"
        class="absolute inset-0 z-20 flex min-h-[14rem] flex-col items-center justify-center gap-3 bg-white/90 p-6 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="Loading samples and tag data"
      >
        <UIcon name="i-heroicons-arrow-path" class="text-primary h-10 w-10 shrink-0 animate-spin" />
        <p class="text-muted max-w-sm text-center text-sm">Loading samples and tag data…</p>
      </div>
      <div v-if="explorerView === 'cards'" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <template v-for="(sec, secIdx) in fileSections" :key="sec.batchId ?? 'unbatched'">
          <div
            class="border-border-muted col-span-full flex items-start justify-between gap-3 border-b pb-2"
            :class="secIdx === 0 ? 'mt-0' : 'mt-6'"
          >
            <h3 class="text-muted min-w-0 flex-1 whitespace-normal text-xs font-normal leading-snug tracking-wide">
              <span class="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span class="font-semibold text-gray-900">
                    <template v-if="sec.batchId !== null">Batch {{ sec.headerParts.titleBold }}</template>
                    <template v-else>{{ sec.headerParts.titleBold }}</template>
                  </span>
                  <span>{{ sec.headerParts.sampleCount }} {{ sec.headerParts.sampleNoun }}</span>
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    :style="{ backgroundColor: BATCH_HEADER_DOT_NOT_ANALYZED }"
                    aria-hidden="true"
                  />
                  <span>{{ sec.headerParts.notYetAnalyzed }} not yet analyzed</span>
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    :style="{ backgroundColor: BATCH_HEADER_DOT_ANALYZED }"
                    aria-hidden="true"
                  />
                  <span>{{ sec.headerParts.analyzed }} analyzed</span>
                </span>
              </span>
            </h3>
            <button
              type="button"
              class="text-primary shrink-0 text-xs font-normal hover:underline"
              @mousedown.stop
              @click.stop="toggleBatchSection(sec)"
            >
              {{ batchSectionFullySelected(sec) ? 'Deselect batch' : 'Select batch' }}
            </button>
          </div>
          <div
            v-for="g in sec.groups"
            :key="g.groupId"
            data-file-card
            :data-keys="g.keys.join(' ')"
            draggable="true"
            class="border-border-muted relative min-w-0 cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition"
            :class="{
              'bg-primary-muted ring-primary ring-2': isGroupSelected(g),
              'z-[80]': analysisPopoverOpenKey === g.primaryKey,
            }"
            @click="onGroupToggle(g)"
            @dragstart="onCardDragStart($event, g)"
            @dragend="onFileCardDragEnd"
          >
            <div class="absolute right-2 top-2 flex items-center gap-1.5" @mousedown.stop @click.stop>
              <UIcon
                v-if="isGroupAnyPermanent(g)"
                name="i-heroicons-lock-closed"
                class="h-3.5 w-3.5 shrink-0 text-red-600"
                :title="
                  isGroupAllPermanent(g)
                    ? 'This sample is protected from auto-deletion when run retention expires.'
                    : 'Some files in this sample are protected from auto-deletion when run retention expires.'
                "
                :aria-label="
                  isGroupAllPermanent(g) ? 'Protected from auto-deletion' : 'Some files protected from auto-deletion'
                "
              />
              <UCheckbox
                :model-value="isGroupSelected(g)"
                :indeterminate="isGroupPartiallySelected(g)"
                @update:model-value="onGroupToggle(g)"
              />
            </div>
            <div class="absolute left-0 top-0 z-[1]" @mousedown.stop @click.stop>
              <EGFileAnalysisHistoryTooltip
                :lab-id="labId"
                :file-key="g.primaryKey"
                :file-name="g.label"
                :batch-name="groupBatchName(g) === '—' ? undefined : groupBatchName(g)"
                :standard-tag-names="groupStandardTagNames(g)"
                :run-usages="groupRunUsages(g)"
                :group-files="g.isGroup ? groupFilesForPopover(g) : undefined"
                variant="card"
                @select-run-files="emit('selectRunFiles', $event)"
                @update:open="onAnalysisPopoverOpen(g.primaryKey, $event)"
              />
            </div>
            <UTooltip :open-delay="500" :ui="s3PathTooltipUi">
              <template #text>
                {{ s3ObjectTooltip(g.primaryKey) }}
              </template>
              <div class="w-full min-w-0 pr-8">
                <div class="mt-7 line-clamp-2 w-full min-w-0 break-all text-sm font-medium leading-snug">
                  {{ g.label }}
                </div>
                <div v-if="folderPathUnderLab(g.primaryKey)" class="text-muted mt-0.5 truncate text-[11px]">
                  {{ folderPathUnderLab(g.primaryKey) }}
                </div>
              </div>
            </UTooltip>
            <div v-if="isGroupPaired(g)" class="mt-1.5">
              <span
                class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                title="Paired-end reads (R1 + R2)"
              >
                <UIcon name="i-heroicons-link" class="h-3 w-3 shrink-0" aria-hidden="true" />
                Paired
              </span>
            </div>
            <div class="text-muted mt-1 text-xs">
              <template v-if="g.isGroup">{{ g.fileCount }} files</template>
              <template v-else>{{ formatFileSize(g.files[0].Size) }}</template>
            </div>
            <div class="mt-2 flex min-h-[1.25rem] min-w-0 max-w-full flex-wrap gap-1">
              <template v-if="groupStandardTagIds(g).length">
                <span
                  v-for="tid in groupStandardTagIds(g)"
                  :key="tid"
                  class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :title="tagById(tid)?.Name || tid"
                  :style="{
                    background: tagById(tid)?.ColorHex || '#e2e2e8',
                    color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                  }"
                  @click.stop
                >
                  <span class="min-w-0 truncate">{{ tagById(tid)?.Name || tid }}</span>
                </span>
              </template>
              <span v-else class="text-muted text-[10px] italic">No tags</span>
            </div>
          </div>
        </template>
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table class="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead>
            <tr class="border-border-muted bg-gray-50/90 text-xs uppercase tracking-wide text-gray-600">
              <th class="border-border-muted w-10 border-b px-3 py-2.5" scope="col" />
              <th class="border-border-muted min-w-0 max-w-[14rem] border-b px-3 py-2.5 font-semibold" scope="col">
                Sample ID
              </th>
              <th class="border-border-muted border-b px-3 py-2.5 font-semibold" scope="col">Batch</th>
              <th class="border-border-muted border-b px-3 py-2.5 font-semibold" scope="col">Status</th>
              <th class="border-border-muted border-b px-3 py-2.5 font-semibold" scope="col">Tags</th>
              <th class="border-border-muted w-28 border-b px-3 py-2.5 font-semibold" scope="col">Expires</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="sec in fileSections" :key="sec.batchId ?? 'unbatched'">
              <tr class="bg-gray-50/95">
                <td colspan="6" class="border-border-muted border-b px-3 py-2.5" scope="colgroup">
                  <div class="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <span
                      class="text-muted min-w-0 flex-1 whitespace-normal text-xs font-normal leading-snug tracking-wide"
                    >
                      <span class="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                          <span class="font-semibold text-gray-900">
                            <template v-if="sec.batchId !== null">Batch {{ sec.headerParts.titleBold }}</template>
                            <template v-else>{{ sec.headerParts.titleBold }}</template>
                          </span>
                          <span>{{ sec.headerParts.sampleCount }} {{ sec.headerParts.sampleNoun }}</span>
                        </span>
                        <span class="inline-flex items-center gap-1.5">
                          <span
                            class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            :style="{ backgroundColor: BATCH_HEADER_DOT_NOT_ANALYZED }"
                            aria-hidden="true"
                          />
                          <span>{{ sec.headerParts.notYetAnalyzed }} not yet analyzed</span>
                        </span>
                        <span class="inline-flex items-center gap-1.5">
                          <span
                            class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            :style="{ backgroundColor: BATCH_HEADER_DOT_ANALYZED }"
                            aria-hidden="true"
                          />
                          <span>{{ sec.headerParts.analyzed }} analyzed</span>
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      class="text-primary ml-auto shrink-0 self-start whitespace-nowrap text-xs font-normal hover:underline"
                      @mousedown.stop
                      @click.stop="toggleBatchSection(sec)"
                    >
                      {{ batchSectionFullySelected(sec) ? 'Deselect batch' : 'Select batch' }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr
                v-for="g in sec.groups"
                :key="g.groupId"
                data-file-card
                :data-keys="g.keys.join(' ')"
                draggable="true"
                class="border-border-muted cursor-pointer border-b transition last:border-b-0"
                :class="{
                  'bg-primary-muted ring-primary ring-2 ring-inset': isGroupSelected(g),
                  'hover:bg-gray-50/80': !isGroupSelected(g),
                  'relative z-[80]': analysisPopoverOpenKey === g.primaryKey,
                }"
                @click="onGroupToggle(g)"
                @dragstart="onCardDragStart($event, g)"
                @dragend="onFileCardDragEnd"
              >
                <td class="px-3 py-2 align-middle" @mousedown.stop @click.stop>
                  <UCheckbox
                    :model-value="isGroupSelected(g)"
                    :indeterminate="isGroupPartiallySelected(g)"
                    @update:model-value="onGroupToggle(g)"
                  />
                </td>
                <td class="min-w-0 max-w-[14rem] overflow-hidden px-3 py-2 align-middle">
                  <UTooltip :open-delay="500" :ui="s3PathTooltipUi">
                    <template #text>
                      {{ s3ObjectTooltip(g.primaryKey) }}
                    </template>
                    <div class="min-w-0">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <UIcon
                          v-if="isGroupAnyPermanent(g)"
                          name="i-heroicons-lock-closed"
                          class="h-3.5 w-3.5 shrink-0 text-red-600"
                          :title="
                            isGroupAllPermanent(g)
                              ? 'This sample is protected from auto-deletion when run retention expires.'
                              : 'Some files in this sample are protected from auto-deletion when run retention expires.'
                          "
                          :aria-label="
                            isGroupAllPermanent(g)
                              ? 'Protected from auto-deletion'
                              : 'Some files protected from auto-deletion'
                          "
                        />
                        <span class="truncate font-medium text-gray-900">{{ g.label }}</span>
                      </div>
                      <div v-if="g.isGroup" class="text-muted truncate text-xs">{{ g.fileCount }} files</div>
                      <div v-else-if="folderPathUnderLab(g.primaryKey)" class="text-muted truncate text-xs">
                        {{ folderPathUnderLab(g.primaryKey) }}
                      </div>
                    </div>
                  </UTooltip>
                </td>
                <td class="text-muted px-3 py-2 align-middle">{{ groupBatchName(g) }}</td>
                <td class="px-3 py-2 align-middle">
                  <span class="inline-flex w-fit max-w-full align-middle" @mousedown.stop @click.stop>
                    <EGFileAnalysisHistoryTooltip
                      :lab-id="labId"
                      :file-key="g.primaryKey"
                      :file-name="g.label"
                      :batch-name="groupBatchName(g) === '—' ? undefined : groupBatchName(g)"
                      :standard-tag-names="groupStandardTagNames(g)"
                      :run-usages="groupRunUsages(g)"
                      :group-files="g.isGroup ? groupFilesForPopover(g) : undefined"
                      variant="table"
                      @select-run-files="emit('selectRunFiles', $event)"
                      @update:open="onAnalysisPopoverOpen(g.primaryKey, $event)"
                    />
                  </span>
                </td>
                <td class="min-w-0 px-3 py-2 align-middle">
                  <div class="flex min-h-[1.25rem] min-w-0 max-w-full flex-wrap gap-1">
                    <template v-if="groupStandardTagIds(g).length">
                      <span
                        v-for="tid in groupStandardTagIds(g)"
                        :key="tid"
                        class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full px-2 py-0.5 text-[10px] font-medium"
                        :title="tagById(tid)?.Name || tid"
                        :style="{
                          background: tagById(tid)?.ColorHex || '#e2e2e8',
                          color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                        }"
                        @click.stop
                      >
                        <span class="min-w-0 truncate">{{ tagById(tid)?.Name || tid }}</span>
                      </span>
                    </template>
                    <span v-else class="text-muted text-[10px] italic">No tags</span>
                  </div>
                </td>
                <td class="text-muted px-3 py-2 align-middle">
                  <UIcon
                    v-if="isGroupAllPermanent(g)"
                    name="i-heroicons-lock-closed"
                    class="inline-block h-3.5 w-3.5 text-red-600"
                    title="This sample is protected from auto-deletion when run retention expires. It does not expire with run retention."
                    aria-label="Protected from auto-deletion; does not expire with run retention"
                  />
                  <span v-else class="tabular-nums">{{ groupExpiresLabel(g) }}</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="noObjectsUnderLabPrefix" class="text-muted mx-auto max-w-lg space-y-3 py-12 text-center text-sm">
        <p class="font-medium text-gray-900">No files found under this lab’s prefix in this bucket</p>
      </div>
      <div v-else-if="allFilesHiddenByFilters" class="text-muted py-8 text-center text-sm">
        No files match your current search or filters. Clear the search box or adjust filters in the left panel.
      </div>
      <div
        class="border-primary bg-primary/10 pointer-events-none fixed z-[9999] rounded border-2"
        :style="lassoStyle"
      />
    </div>
  </div>
</template>

<style scoped>
  /** Lasso drag highlight only — selection rings come from Vue `:class` on `[data-file-card]`. */
  [data-file-card].eg-data-collections-lasso-hit {
    box-shadow: 0 0 0 2px #5524e0;
    background-color: #eee9fc;
  }
</style>
