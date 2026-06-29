<script setup lang="ts">
  import type {
    LaboratoryDataTag,
    LaboratoryRunUsageSummary,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type { LaboratorySample } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import EGFileAnalysisHistoryTooltip from '@FE/components/EGFileAnalysisHistoryTooltip.vue';
  import EGSampleTagSidebar from '@FE/components/EGSampleTagSidebar.vue';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { SAMPLE_LAYOUT_LABELS } from '@FE/utils/data-collections-selection';
  import { exceedsTagNameMaxLength } from '@FE/utils/data-collections-name-validation';

  const props = withDefaults(
    defineProps<{
      labId: string;
      samples: LaboratorySample[];
      tags: LaboratoryDataTag[];
      sampleIdToTagIds: Record<string, string[]>;
      sampleIdToRunUsages: Record<string, LaboratoryRunUsageSummary[]>;
      loading: boolean;
      selectedIds: string[];
      search: string;
      tagsFilterUntagged: boolean;
      tagsFilterTagIds: string[];
      s3Configured?: boolean;
    }>(),
    {
      s3Configured: true,
    },
  );

  const emit = defineEmits<{
    'update:selectedIds': [ids: string[]];
    'update:search': [value: string];
    'update:tagsFilterUntagged': [value: boolean];
    'update:tagsFilterTagIds': [ids: string[]];
    import: [];
    'build-collection': [];
    'tags-updated': [];
    'tag-created': [];
    'tag-deleted': [tagId: string];
  }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const SEQUENCE_SET_IDS_CHUNK = 100;

  const bulkPanelMode = ref<'closed' | 'add' | 'remove'>('closed');
  const bulkAddTagIds = ref<string[]>([]);
  const bulkRemoveTagIds = ref<string[]>([]);
  const showInlineCreateTag = ref(false);
  const inlineNewTagName = ref('');
  const inlineNewTagColor = ref('#5B4FD4');
  const bulkPanelContentEl = ref<HTMLElement | null>(null);

  /** Cards grid vs tabular layout (matches file explorer). */
  const explorerView = ref<'cards' | 'table'>('cards');

  /** While a sample's analysis popover is open, that card/row is stacked above siblings. */
  const analysisPopoverOpenKey = ref<string | null>(null);

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

  const BATCH_HEADER_DOT_NOT_ANALYZED = '#EF9F27';
  const BATCH_HEADER_DOT_ANALYZED = '#2DB48F';

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

  const standardTags = computed(() => props.tags.filter((t) => (t.Kind ?? 'standard') === 'standard'));
  const batchTags = computed(() => props.tags.filter((t) => t.Kind === 'batch'));

  type SampleSection = {
    batchId: string | null;
    title: string;
    samples: LaboratorySample[];
  };

  const bulkPanelBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));
  const hasSelection = computed(() => props.selectedIds.length > 0);
  const bulkPanelOpen = computed(() => bulkPanelMode.value !== 'closed');

  const inlineTagNameInvalid = computed(() => exceedsTagNameMaxLength(inlineNewTagName.value));
  const canCreateInlineTag = computed(() => !!inlineNewTagName.value.trim() && !inlineTagNameInvalid.value);

  function standardTagIdsForSet(setId: string): string[] {
    const tagIdSet = new Set(standardTags.value.map((t) => t.TagId));
    return (props.sampleIdToTagIds[setId] ?? []).filter((tid) => tagIdSet.has(tid));
  }

  const setsMatchingSearch = computed(() => {
    let rows = props.samples;
    const q = props.search.trim().toLowerCase();
    if (q) rows = rows.filter((s) => s.Name.toLowerCase().includes(q));
    return rows;
  });

  const filtered = computed(() => {
    let list = setsMatchingSearch.value;
    if (props.tagsFilterUntagged) {
      list = list.filter((s) => !standardTagIdsForSet(s.SampleId).length);
    } else if (props.tagsFilterTagIds.length > 0) {
      const selected = new Set(props.tagsFilterTagIds);
      list = list.filter((s) => standardTagIdsForSet(s.SampleId).some((tid) => selected.has(tid)));
    }
    return list;
  });

  const sampleSections = computed((): SampleSection[] => {
    const nameById = new Map(batchTags.value.map((t) => [t.TagId, t.Name]));
    const createdAtById = new Map(batchTags.value.map((t) => [t.TagId, t.CreatedAt ?? '']));
    const groups = new Map<string | null, LaboratorySample[]>();
    for (const s of filtered.value) {
      const bid = s.BatchTagId ?? null;
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid)!.push(s);
    }
    const batchEntries = [...groups.entries()].filter(([k]) => k !== null) as [string, LaboratorySample[]][];
    batchEntries.sort((a, b) => {
      const ca = createdAtById.get(a[0]) ?? '';
      const cb = createdAtById.get(b[0]) ?? '';
      const byDate = cb.localeCompare(ca);
      if (byDate !== 0) return byDate;
      const na = nameById.get(a[0]) ?? a[0];
      const nb = nameById.get(b[0]) ?? b[0];
      return na.localeCompare(nb);
    });
    const sections: SampleSection[] = [];
    const unbatched = groups.get(null);
    if (unbatched?.length) {
      sections.push({ batchId: null, title: 'Unbatched', samples: unbatched });
    }
    for (const [bid, samples] of batchEntries) {
      sections.push({
        batchId: bid,
        title: nameById.get(bid) ?? bid,
        samples,
      });
    }
    return sections;
  });

  const tagsOnSelection = computed(() => {
    const sel = props.selectedIds;
    if (!sel.length) return [] as { tagId: string; count: number }[];
    const counts = new Map<string, number>();
    for (const setId of sel) {
      for (const tid of standardTagIdsForSet(setId)) {
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

  const removableTagIds = computed(() => tagsOnSelection.value.map((t) => t.tagId));

  function tagById(id: string): LaboratoryDataTag | undefined {
    return props.tags.find((t) => t.TagId === id);
  }

  function batchDisplayName(sample: LaboratorySample): string {
    if (!sample.BatchTagId) return '—';
    return tagById(sample.BatchTagId)?.Name ?? sample.BatchTagId;
  }

  function runUsagesForSample(sampleId: string): LaboratoryRunUsageSummary[] {
    return props.sampleIdToRunUsages[sampleId] ?? [];
  }

  function runCountForSample(sampleId: string): number {
    return runUsagesForSample(sampleId).length;
  }

  function standardTagNamesForSample(sampleId: string): string[] {
    return tagIdsForSet(sampleId).map((tid) => tagById(tid)?.Name ?? tid);
  }

  function onAnalysisPopoverOpen(sampleId: string, open: boolean): void {
    if (open) {
      analysisPopoverOpenKey.value = sampleId;
    } else if (analysisPopoverOpenKey.value === sampleId) {
      analysisPopoverOpenKey.value = null;
    }
  }

  type BatchSectionHeaderParts = {
    titleBold: string;
    sampleCount: number;
    sampleNoun: string;
    notYetAnalyzed: number;
    analyzed: number;
  };

  function batchSectionHeaderParts(sec: SampleSection): BatchSectionHeaderParts {
    const n = sec.samples.length;
    const sampleNoun = n === 1 ? 'sample' : 'samples';
    let notYetAnalyzed = 0;
    let analyzed = 0;
    for (const s of sec.samples) {
      if (runCountForSample(s.SampleId) > 0) analyzed += 1;
      else notYetAnalyzed += 1;
    }
    return {
      titleBold: sec.title,
      sampleCount: n,
      sampleNoun,
      notYetAnalyzed,
      analyzed,
    };
  }

  function selectSamplesForRun(runId: string): void {
    const ids = props.samples
      .filter((s) => runUsagesForSample(s.SampleId).some((u) => u.RunId === runId))
      .map((s) => s.SampleId);
    emit('update:selectedIds', ids);
  }

  function batchSectionFullySelected(sec: SampleSection): boolean {
    if (!sec.samples.length) return false;
    return sec.samples.every((s) => isSelected(s.SampleId));
  }

  function toggleBatchSection(sec: SampleSection): void {
    const ids = sec.samples.map((s) => s.SampleId);
    if (batchSectionFullySelected(sec)) {
      const remove = new Set(ids);
      emit(
        'update:selectedIds',
        props.selectedIds.filter((id) => !remove.has(id)),
      );
    } else {
      const merged = new Set([...props.selectedIds, ...ids]);
      emit('update:selectedIds', [...merged]);
    }
  }

  function pillTextColor(bgHex: string): string {
    const h = bgHex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 150 ? '#1a1a2e' : '#ffffff';
  }

  function isSelected(setId: string): boolean {
    return props.selectedIds.includes(setId);
  }

  function contentsLabel(s: LaboratorySample): string {
    if (s.ContentsSummary) return s.ContentsSummary;
    const layout = SAMPLE_LAYOUT_LABELS[s.Layout] ?? s.Layout;
    return `${layout} · ${s.FileCount} file(s)`;
  }

  function tagIdsForSet(setId: string): string[] {
    return props.sampleIdToTagIds[setId] ?? [];
  }

  function toggle(id: string): void {
    const next = new Set(props.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit('update:selectedIds', [...next]);
  }

  function selectAllDisplayed(): void {
    emit(
      'update:selectedIds',
      filtered.value.map((s) => s.SampleId),
    );
  }

  function clearSelection(): void {
    emit('update:selectedIds', []);
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
        const id = h.dataset.key;
        if (id) added.push(id);
      }
      h.classList.remove('eg-data-collections-lasso-hit');
    });
    if (added.length) {
      const merged = new Set([...props.selectedIds, ...added]);
      emit('update:selectedIds', [...merged]);
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

  function onSampleItemKeydown(e: KeyboardEvent, setId: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(setId);
    }
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

  async function addTagsToSamplesInChunks(
    setIds: string[],
    addTagIds: string[],
    removeTagIds: string[],
  ): Promise<void> {
    for (let i = 0; i < setIds.length; i += SEQUENCE_SET_IDS_CHUNK) {
      const chunk = setIds.slice(i, i + SEQUENCE_SET_IDS_CHUNK);
      await $api.dataCollections.addTagsToSamples({
        LaboratoryId: props.labId,
        SampleIds: chunk,
        AddTagIds: addTagIds.length ? addTagIds : undefined,
        RemoveTagIds: removeTagIds.length ? removeTagIds : undefined,
      });
    }
  }

  async function createTagInline(): Promise<void> {
    const trimmed = inlineNewTagName.value.trim();
    if (!trimmed || exceedsTagNameMaxLength(trimmed)) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const created = await $api.dataCollections.createTag({
        LaboratoryId: props.labId,
        Name: trimmed,
        ColorHex: inlineNewTagColor.value,
      });
      bulkAddTagIds.value = [...new Set([...bulkAddTagIds.value, created.TagId])];
      showInlineCreateTag.value = false;
      inlineNewTagName.value = '';
      inlineNewTagColor.value = '#5B4FD4';
      toast.success('Tag created');
      emit('tag-created');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create tag failed');
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function applyBulkChanges(): Promise<void> {
    if (!props.selectedIds.length) return;
    const setIds = [...props.selectedIds];
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
      await addTagsToSamplesInChunks(setIds, add, remove);
      toast.success('Tags updated');
      closeBulkPanel();
      emit('tags-updated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white">
    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <EGSampleTagSidebar
        :lab-id="labId"
        :tags="tags"
        :samples="samples"
        :sample-id-to-tag-ids="sampleIdToTagIds"
        :search="search"
        :tags-filter-untagged="tagsFilterUntagged"
        :tags-filter-tag-ids="tagsFilterTagIds"
        :loading="loading"
        @update:tags-filter-untagged="emit('update:tagsFilterUntagged', $event)"
        @update:tags-filter-tag-ids="emit('update:tagsFilterTagIds', $event)"
        @tag-created="emit('tag-created')"
        @tag-deleted="emit('tag-deleted', $event)"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          class="border-border-muted flex flex-wrap items-center gap-3 border-b px-4 py-3"
          role="toolbar"
          aria-label="Sample explorer tools"
        >
          <label class="sr-only" for="sequence-set-search">Search samples</label>
          <UInput
            id="sequence-set-search"
            :model-value="search"
            placeholder="Search by sample ID or tag…"
            class="max-w-xs"
            size="sm"
            @update:model-value="emit('update:search', String($event ?? ''))"
          />
          <div class="border-border-muted flex shrink-0 rounded-lg border p-0.5" role="group" aria-label="View mode">
            <UButton
              size="xs"
              square
              icon="i-heroicons-squares-2x2"
              :variant="explorerView === 'cards' ? 'soft' : 'ghost'"
              class="rounded-md"
              aria-label="Card view"
              :aria-pressed="explorerView === 'cards'"
              @click="explorerView = 'cards'"
            />
            <UButton
              size="xs"
              square
              icon="i-heroicons-list-bullet"
              :variant="explorerView === 'table' ? 'soft' : 'ghost'"
              class="rounded-md"
              aria-label="Table view"
              :aria-pressed="explorerView === 'table'"
              @click="explorerView = 'table'"
            />
          </div>
          <div class="ml-auto shrink-0">
            <UButton
              size="sm"
              :disabled="!s3Configured"
              :title="
                s3Configured ? undefined : 'Configure the lab default S3 bucket in Settings before importing data.'
              "
              @click="emit('import')"
            >
              Import data
            </UButton>
          </div>
        </div>

        <div class="border-border-muted flex flex-wrap items-center gap-2 border-b bg-gray-50 px-4 py-2">
          <span class="text-xs font-semibold leading-snug text-gray-900" aria-live="polite" aria-atomic="true">
            {{ filtered.length }} sample{{ filtered.length === 1 ? '' : 's' }}
          </span>
          <div class="ml-auto flex shrink-0">
            <UButton
              v-if="hasSelection"
              size="xs"
              variant="ghost"
              :aria-label="`Deselect all ${selectedIds.length} selected samples`"
              @click="clearSelection"
            >
              Deselect all ({{ selectedIds.length }})
            </UButton>
            <UButton
              v-else
              size="xs"
              variant="ghost"
              :disabled="!filtered.length || loading"
              :aria-label="`Select all ${filtered.length} displayed samples`"
              @click="selectAllDisplayed"
            >
              Select all ({{ filtered.length }})
            </UButton>
          </div>
        </div>

        <div
          ref="scrollEl"
          class="relative min-h-0 flex-1 overflow-auto p-2"
          role="region"
          aria-label="Samples"
          @mousedown="onScrollHostMouseDown"
        >
          <p class="sr-only">
            Drag on empty space to select multiple samples with the mouse. Use Enter or Space on a sample card or table
            row to toggle selection.
          </p>
          <div
            v-if="loading"
            class="absolute inset-0 z-20 flex min-h-[14rem] flex-col items-center justify-center gap-3 bg-white/90 p-6 backdrop-blur-[1px]"
            aria-busy="true"
            aria-label="Loading samples"
          >
            <UIcon name="i-heroicons-arrow-path" class="text-primary h-10 w-10 shrink-0 animate-spin" />
            <p class="text-muted max-w-sm text-center text-sm">Loading samples…</p>
          </div>

          <div
            v-else-if="!filtered.length"
            class="flex min-h-[14rem] items-center justify-center p-6 text-center text-sm text-gray-400"
          >
            No samples match your current search or filters.
          </div>

          <div
            v-else-if="explorerView === 'cards'"
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            role="list"
            aria-label="Samples"
            aria-multiselectable="true"
          >
            <template v-for="(sec, secIdx) in sampleSections" :key="sec.batchId ?? 'unbatched'">
              <div
                class="border-border-muted col-span-full flex items-start justify-between gap-3 border-b pb-2"
                :class="secIdx === 0 ? 'mt-0' : 'mt-6'"
                role="presentation"
              >
                <h3 class="text-muted min-w-0 flex-1 whitespace-normal text-xs font-normal leading-snug tracking-wide">
                  <span class="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      <span class="font-semibold text-gray-900">
                        <template v-if="sec.batchId !== null">
                          Batch {{ batchSectionHeaderParts(sec).titleBold }}
                        </template>
                        <template v-else>{{ batchSectionHeaderParts(sec).titleBold }}</template>
                      </span>
                      <span>
                        {{ batchSectionHeaderParts(sec).sampleCount }}
                        {{ batchSectionHeaderParts(sec).sampleNoun }}
                      </span>
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        :style="{ backgroundColor: BATCH_HEADER_DOT_NOT_ANALYZED }"
                        aria-hidden="true"
                      />
                      <span>{{ batchSectionHeaderParts(sec).notYetAnalyzed }} not yet analyzed</span>
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        :style="{ backgroundColor: BATCH_HEADER_DOT_ANALYZED }"
                        aria-hidden="true"
                      />
                      <span>{{ batchSectionHeaderParts(sec).analyzed }} analyzed</span>
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
                v-for="s in sec.samples"
                :key="s.SampleId"
                data-file-card
                :data-key="s.SampleId"
                role="listitem"
                tabindex="0"
                class="border-border-muted focus-visible:ring-primary relative min-w-0 cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                :class="{
                  'bg-primary-muted ring-primary ring-2': isSelected(s.SampleId),
                  'z-[80]': analysisPopoverOpenKey === s.SampleId,
                }"
                :aria-selected="isSelected(s.SampleId)"
                :aria-label="`${s.Name}, ${contentsLabel(s)}`"
                @click="toggle(s.SampleId)"
                @keydown="onSampleItemKeydown($event, s.SampleId)"
              >
                <div class="absolute left-0 top-0 z-[1]" @mousedown.stop @click.stop>
                  <EGFileAnalysisHistoryTooltip
                    :lab-id="labId"
                    :file-key="s.SampleId"
                    :file-name="s.Name"
                    :batch-name="batchDisplayName(s) === '—' ? undefined : batchDisplayName(s)"
                    :standard-tag-names="standardTagNamesForSample(s.SampleId)"
                    :run-usages="runUsagesForSample(s.SampleId)"
                    variant="card"
                    @select-run-files="selectSamplesForRun($event.runId)"
                    @update:open="onAnalysisPopoverOpen(s.SampleId, $event)"
                  />
                </div>
                <div class="absolute right-2 top-2" @mousedown.stop @click.stop>
                  <UCheckbox :model-value="isSelected(s.SampleId)" @update:model-value="toggle(s.SampleId)" />
                </div>
                <div class="w-full min-w-0 pr-8">
                  <div
                    class="mt-7 line-clamp-2 w-full min-w-0 break-all text-sm font-medium leading-snug text-gray-900"
                  >
                    {{ s.Name }}
                  </div>
                  <div class="text-muted mt-1 text-xs">{{ contentsLabel(s) }}</div>
                </div>
                <div class="mt-2 flex min-h-[1.25rem] min-w-0 max-w-full flex-wrap gap-1">
                  <span
                    v-if="!standardTagIdsForSet(s.SampleId).length"
                    class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                    @click.stop
                  >
                    <span class="truncate">Untagged</span>
                  </span>
                  <template v-else>
                    <span
                      v-for="tid in standardTagIdsForSet(s.SampleId)"
                      :key="tid"
                      class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full px-2 py-0.5 text-[10px] font-medium"
                      :title="tagById(tid)?.Name || tid"
                      :style="{
                        background: tagById(tid)?.ColorHex || '#e2e2e8',
                        color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                      }"
                      @click.stop
                    >
                      <span class="truncate">{{ tagById(tid)?.Name || tid }}</span>
                    </span>
                  </template>
                </div>
              </div>
            </template>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[36rem] border-collapse text-left text-sm" aria-label="Samples">
              <thead class="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th class="w-10 p-3" />
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Sample ID</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Contents</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Tags</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Run Status</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="sec in sampleSections" :key="sec.batchId ?? 'unbatched-table'">
                  <tr class="bg-gray-50/95">
                    <td colspan="5" class="border-t border-gray-100 px-3 py-2.5" scope="colgroup">
                      <div class="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <span class="text-muted min-w-0 flex-1 text-xs font-normal leading-snug tracking-wide">
                          <span class="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                              <span class="font-semibold text-gray-900">
                                <template v-if="sec.batchId !== null">
                                  Batch {{ batchSectionHeaderParts(sec).titleBold }}
                                </template>
                                <template v-else>{{ batchSectionHeaderParts(sec).titleBold }}</template>
                              </span>
                              <span>
                                {{ batchSectionHeaderParts(sec).sampleCount }}
                                {{ batchSectionHeaderParts(sec).sampleNoun }}
                              </span>
                            </span>
                            <span class="inline-flex items-center gap-1.5">
                              <span
                                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                :style="{ backgroundColor: BATCH_HEADER_DOT_NOT_ANALYZED }"
                                aria-hidden="true"
                              />
                              <span>{{ batchSectionHeaderParts(sec).notYetAnalyzed }} not yet analyzed</span>
                            </span>
                            <span class="inline-flex items-center gap-1.5">
                              <span
                                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                :style="{ backgroundColor: BATCH_HEADER_DOT_ANALYZED }"
                                aria-hidden="true"
                              />
                              <span>{{ batchSectionHeaderParts(sec).analyzed }} analyzed</span>
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
                    v-for="s in sec.samples"
                    :key="s.SampleId"
                    data-file-card
                    :data-key="s.SampleId"
                    tabindex="0"
                    class="border-t border-gray-100 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
                    :class="{
                      'bg-primary-50': isSelected(s.SampleId),
                      'relative z-[80]': analysisPopoverOpenKey === s.SampleId,
                    }"
                    :aria-selected="isSelected(s.SampleId)"
                    @click="toggle(s.SampleId)"
                    @keydown="onSampleItemKeydown($event, s.SampleId)"
                  >
                    <td class="p-3" @mousedown.stop @click.stop>
                      <UCheckbox :model-value="isSelected(s.SampleId)" @update:model-value="toggle(s.SampleId)" />
                    </td>
                    <td class="p-3 font-medium">{{ s.Name }}</td>
                    <td class="p-3 text-gray-600">{{ contentsLabel(s) }}</td>
                    <td class="p-3">
                      <div class="flex min-w-0 max-w-full flex-wrap gap-1">
                        <span
                          v-if="!standardTagIdsForSet(s.SampleId).length"
                          class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                          @click.stop
                        >
                          <span class="truncate">Untagged</span>
                        </span>
                        <template v-else>
                          <span
                            v-for="tid in standardTagIdsForSet(s.SampleId)"
                            :key="tid"
                            class="inline-flex min-w-0 max-w-full overflow-hidden rounded-full px-2 py-0.5 text-[10px] font-medium"
                            :title="tagById(tid)?.Name || tid"
                            :style="{
                              background: tagById(tid)?.ColorHex || '#e2e2e8',
                              color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                            }"
                            @click.stop
                          >
                            <span class="truncate">{{ tagById(tid)?.Name || tid }}</span>
                          </span>
                        </template>
                      </div>
                    </td>
                    <td class="px-3 py-2 align-middle">
                      <span class="inline-flex w-fit max-w-full align-middle" @mousedown.stop @click.stop>
                        <EGFileAnalysisHistoryTooltip
                          :lab-id="labId"
                          :file-key="s.SampleId"
                          :file-name="s.Name"
                          :batch-name="batchDisplayName(s) === '—' ? undefined : batchDisplayName(s)"
                          :standard-tag-names="standardTagNamesForSample(s.SampleId)"
                          :run-usages="runUsagesForSample(s.SampleId)"
                          variant="table"
                          @select-run-files="selectSamplesForRun($event.runId)"
                          @update:open="onAnalysisPopoverOpen(s.SampleId, $event)"
                        />
                      </span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div
            class="border-primary bg-primary/10 pointer-events-none fixed z-[9999] rounded border-2"
            :style="lassoStyle"
          />
        </div>
      </div>
    </div>

    <div class="border-border-muted shrink-0 border-t bg-gray-50" role="region" aria-label="Bulk tag actions">
      <div class="flex flex-wrap items-center gap-2 px-4 py-2">
        <span v-if="hasSelection" class="text-muted text-xs" aria-live="polite" aria-atomic="true">
          {{ selectedIds.length }} sample(s) selected
        </span>
        <span v-else class="text-muted text-xs">Select samples to add or remove tags in bulk.</span>
        <div v-if="hasSelection" class="ml-auto flex flex-wrap items-center gap-2">
          <UIcon v-if="bulkPanelBusy" name="i-heroicons-arrow-path" class="text-muted h-5 w-5 shrink-0 animate-spin" />
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openAddBulkPanel">Add Tags</UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openRemoveBulkPanel">
            Remove Tags
          </UButton>
          <UButton size="sm" :disabled="bulkPanelBusy" @click="emit('build-collection')">
            Build sequence collection
          </UButton>
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
        aria-label="Updating tags"
      >
        <div class="text-muted flex flex-col items-center gap-2 text-sm">
          <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin" />
          <span>Updating tags…</span>
        </div>
      </div>
      <div class="grid gap-6 md:grid-cols-2">
        <div>
          <h3 class="text-muted mb-3 text-xs font-semibold uppercase tracking-wide">On Selection</h3>
          <p v-if="!tagsOnSelection.length" class="text-muted text-sm">No tags on the selected samples.</p>
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
                <span class="truncate font-medium">{{ tagById(row.tagId)?.Name ?? row.tagId }}</span>
              </span>
              <span class="text-muted shrink-0 text-xs tabular-nums">{{ row.count }} / {{ selectedIds.length }}</span>
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
          <p v-if="!removableTagIds.length" class="text-muted text-sm">No tags on the selected samples to remove.</p>
          <ul v-else class="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
            <li
              v-for="tid in removableTagIds"
              :key="'rm-' + tid"
              class="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-gray-50"
            >
              <UCheckbox :model-value="bulkRemoveTagIds.includes(tid)" @update:model-value="toggleBulkRemoveTag(tid)" />
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
</template>

<style scoped>
  /** Lasso drag highlight only — selection rings come from Vue `:class` on `[data-file-card]`. */
  [data-file-card].eg-data-collections-lasso-hit {
    box-shadow: 0 0 0 2px #5524e0;
    background-color: #eee9fc;
  }
</style>
