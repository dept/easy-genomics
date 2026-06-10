<script setup lang="ts">
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type { LaboratorySequenceSet } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import EGSequenceSetTagSidebar from '@FE/components/EGSequenceSetTagSidebar.vue';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { SEQUENCE_SET_LAYOUT_LABELS } from '@FE/utils/data-collections-selection';
  import { exceedsTagNameMaxLength } from '@FE/utils/data-collections-name-validation';

  const props = defineProps<{
    labId: string;
    sequenceSets: LaboratorySequenceSet[];
    tags: LaboratoryDataTag[];
    setIdToTagIds: Record<string, string[]>;
    loading: boolean;
    selectedIds: string[];
    search: string;
    tagsFilterUntagged: boolean;
    tagsFilterTagIds: string[];
  }>();

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

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

  const standardTags = computed(() => props.tags.filter((t) => (t.Kind ?? 'standard') === 'standard'));

  const bulkPanelBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));
  const hasSelection = computed(() => props.selectedIds.length > 0);
  const bulkPanelOpen = computed(() => bulkPanelMode.value !== 'closed');

  const inlineTagNameInvalid = computed(() => exceedsTagNameMaxLength(inlineNewTagName.value));
  const canCreateInlineTag = computed(() => !!inlineNewTagName.value.trim() && !inlineTagNameInvalid.value);

  function standardTagIdsForSet(setId: string): string[] {
    const tagIdSet = new Set(standardTags.value.map((t) => t.TagId));
    return (props.setIdToTagIds[setId] ?? []).filter((tid) => tagIdSet.has(tid));
  }

  const setsMatchingSearch = computed(() => {
    let rows = props.sequenceSets;
    const q = props.search.trim().toLowerCase();
    if (q) rows = rows.filter((s) => s.Name.toLowerCase().includes(q));
    return rows;
  });

  const filtered = computed(() => {
    let list = setsMatchingSearch.value;
    if (props.tagsFilterUntagged) {
      list = list.filter((s) => !standardTagIdsForSet(s.SequenceSetId).length);
    } else if (props.tagsFilterTagIds.length > 0) {
      const selected = new Set(props.tagsFilterTagIds);
      list = list.filter((s) => standardTagIdsForSet(s.SequenceSetId).some((tid) => selected.has(tid)));
    }
    return list;
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

  function contentsLabel(s: LaboratorySequenceSet): string {
    if (s.ContentsSummary) return s.ContentsSummary;
    const layout = SEQUENCE_SET_LAYOUT_LABELS[s.Layout] ?? s.Layout;
    return `${layout} · ${s.FileCount} file(s)`;
  }

  function tagIdsForSet(setId: string): string[] {
    return props.setIdToTagIds[setId] ?? [];
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
      filtered.value.map((s) => s.SequenceSetId),
    );
  }

  function clearSelection(): void {
    emit('update:selectedIds', []);
  }

  function onSequenceSetItemKeydown(e: KeyboardEvent, setId: string): void {
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

  async function addTagsToSequenceSetsInChunks(
    setIds: string[],
    addTagIds: string[],
    removeTagIds: string[],
  ): Promise<void> {
    for (let i = 0; i < setIds.length; i += SEQUENCE_SET_IDS_CHUNK) {
      const chunk = setIds.slice(i, i + SEQUENCE_SET_IDS_CHUNK);
      await $api.dataCollections.addTagsToSequenceSets({
        LaboratoryId: props.labId,
        SequenceSetIds: chunk,
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
      await addTagsToSequenceSetsInChunks(setIds, add, remove);
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
      <EGSequenceSetTagSidebar
        :lab-id="labId"
        :tags="tags"
        :sequence-sets="sequenceSets"
        :set-id-to-tag-ids="setIdToTagIds"
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
          aria-label="Sequence set explorer tools"
        >
          <label class="sr-only" for="sequence-set-search">Search sequence sets</label>
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
            <UButton size="sm" @click="emit('import')">Import data</UButton>
          </div>
        </div>

        <div class="border-border-muted flex flex-wrap items-center gap-2 border-b bg-gray-50 px-4 py-2">
          <span class="text-xs font-semibold leading-snug text-gray-900" aria-live="polite" aria-atomic="true">
            {{ filtered.length }} sequence set{{ filtered.length === 1 ? '' : 's' }}
          </span>
          <div class="ml-auto flex shrink-0">
            <UButton
              v-if="hasSelection"
              size="xs"
              variant="ghost"
              :aria-label="`Deselect all ${selectedIds.length} selected sequence sets`"
              @click="clearSelection"
            >
              Deselect all ({{ selectedIds.length }})
            </UButton>
            <UButton
              v-else
              size="xs"
              variant="ghost"
              :disabled="!filtered.length || loading"
              :aria-label="`Select all ${filtered.length} displayed sequence sets`"
              @click="selectAllDisplayed"
            >
              Select all ({{ filtered.length }})
            </UButton>
          </div>
        </div>

        <div class="relative min-h-0 flex-1 overflow-auto p-2" role="region" aria-label="Sequence sets">
          <p class="sr-only">Use Enter or Space on a sequence set card or table row to toggle selection.</p>
          <div
            v-if="loading"
            class="absolute inset-0 z-20 flex min-h-[14rem] flex-col items-center justify-center gap-3 bg-white/90 p-6 backdrop-blur-[1px]"
            aria-busy="true"
            aria-label="Loading sequence sets"
          >
            <UIcon name="i-heroicons-arrow-path" class="text-primary h-10 w-10 shrink-0 animate-spin" />
            <p class="text-muted max-w-sm text-center text-sm">Loading sequence sets…</p>
          </div>

          <div
            v-else-if="!filtered.length"
            class="flex min-h-[14rem] items-center justify-center p-6 text-center text-sm text-gray-400"
          >
            No sequence sets match your current search or filters.
          </div>

          <div
            v-else-if="explorerView === 'cards'"
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            role="list"
            aria-label="Sequence sets"
            aria-multiselectable="true"
          >
            <div
              v-for="s in filtered"
              :key="s.SequenceSetId"
              role="listitem"
              tabindex="0"
              class="border-border-muted focus-visible:ring-primary relative min-w-0 cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              :class="{
                'bg-primary-muted ring-primary ring-2': isSelected(s.SequenceSetId),
              }"
              :aria-selected="isSelected(s.SequenceSetId)"
              :aria-label="`${s.Name}, ${contentsLabel(s)}`"
              @click="toggle(s.SequenceSetId)"
              @keydown="onSequenceSetItemKeydown($event, s.SequenceSetId)"
            >
              <div class="absolute right-2 top-2" @mousedown.stop @click.stop>
                <UCheckbox :model-value="isSelected(s.SequenceSetId)" @update:model-value="toggle(s.SequenceSetId)" />
              </div>
              <div class="w-full min-w-0 pr-8">
                <div class="line-clamp-2 w-full min-w-0 break-all text-sm font-medium leading-snug text-gray-900">
                  {{ s.Name }}
                </div>
                <div class="text-muted mt-1 text-xs">{{ contentsLabel(s) }}</div>
              </div>
              <div class="mt-2 flex min-h-[1.25rem] min-w-0 max-w-full flex-wrap gap-1">
                <template v-if="tagIdsForSet(s.SequenceSetId).length">
                  <span
                    v-for="tid in tagIdsForSet(s.SequenceSetId)"
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
              <div class="text-muted mt-2 flex items-center justify-between gap-2 text-[10px]">
                <span class="min-w-0 truncate">{{ s.ImportSource?.label || '—' }}</span>
                <span class="shrink-0">
                  {{ s.CreatedAt ? new Date(s.CreatedAt).toLocaleDateString() : '—' }}
                </span>
              </div>
            </div>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[48rem] border-collapse text-left text-sm" aria-label="Sequence sets">
              <thead class="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th class="w-10 p-3" />
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Sample ID</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Contents</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Tags</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Source</th>
                  <th class="p-3 text-left text-xs uppercase text-gray-400">Created</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in filtered"
                  :key="s.SequenceSetId"
                  tabindex="0"
                  class="border-t border-gray-100 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
                  :class="{ 'bg-primary-50': isSelected(s.SequenceSetId) }"
                  :aria-selected="isSelected(s.SequenceSetId)"
                  @click="toggle(s.SequenceSetId)"
                  @keydown="onSequenceSetItemKeydown($event, s.SequenceSetId)"
                >
                  <td class="p-3" @mousedown.stop @click.stop>
                    <UCheckbox
                      :model-value="isSelected(s.SequenceSetId)"
                      @update:model-value="toggle(s.SequenceSetId)"
                    />
                  </td>
                  <td class="p-3 font-medium">{{ s.Name }}</td>
                  <td class="p-3 text-gray-600">{{ contentsLabel(s) }}</td>
                  <td class="p-3">
                    <span
                      v-for="tid in tagIdsForSet(s.SequenceSetId)"
                      :key="tid"
                      class="mr-1 inline-block rounded-full px-2 py-0.5 text-xs"
                      :style="{
                        background: (tagById(tid)?.ColorHex || '#eee') + '33',
                        color: tagById(tid)?.ColorHex,
                      }"
                    >
                      {{ tagById(tid)?.Name || tid }}
                    </span>
                  </td>
                  <td class="p-3 text-xs text-gray-400">{{ s.ImportSource?.label || '—' }}</td>
                  <td class="p-3 text-xs text-gray-400">
                    {{ s.CreatedAt ? new Date(s.CreatedAt).toLocaleDateString() : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="border-border-muted shrink-0 border-t bg-gray-50" role="region" aria-label="Bulk tag actions">
      <div class="flex flex-wrap items-center gap-2 px-4 py-2">
        <span v-if="hasSelection" class="text-muted text-xs" aria-live="polite" aria-atomic="true">
          {{ selectedIds.length }} sequence set(s) selected
        </span>
        <span v-else class="text-muted text-xs">Select sequence sets to add or remove tags in bulk.</span>
        <div v-if="hasSelection" class="ml-auto flex flex-wrap items-center gap-2">
          <UIcon v-if="bulkPanelBusy" name="i-heroicons-arrow-path" class="text-muted h-5 w-5 shrink-0 animate-spin" />
          <UButton size="sm" variant="soft" :disabled="bulkPanelBusy" @click="openAddBulkPanel">Add Tags</UButton>
          <UButton size="sm" variant="outline" :disabled="bulkPanelBusy" @click="openRemoveBulkPanel">
            Remove Tags
          </UButton>
          <UButton size="sm" :disabled="bulkPanelBusy" @click="emit('build-collection')">Build data collection</UButton>
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
          <p v-if="!tagsOnSelection.length" class="text-muted text-sm">No tags on the selected sequence sets.</p>
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
          <p v-if="!removableTagIds.length" class="text-muted text-sm">
            No tags on the selected sequence sets to remove.
          </p>
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
