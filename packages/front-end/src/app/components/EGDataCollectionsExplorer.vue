<script setup lang="ts">
  /**
   * File grid, folder shortcuts, lasso selection, and drag/drop targets for tagging.
   * Parent (EGDataCollectionsPage) owns data fetching and tag sidebar.
   */
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';

  const props = defineProps<{
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
    batchTags?: LaboratoryDataTag[];
    tags: LaboratoryDataTag[];
    selectedKeys: string[];
    loading: boolean;
    search: string;
    /** Files returned for the current S3 prefix (before search / tag filters in the parent). */
    listingFileCount: number;
    /** Recursive listing stopped at MaxTotalKeys; more objects exist in S3. */
    listingTruncated?: boolean;
  }>();

  const emit = defineEmits<{
    'update:search': [v: string];
    'update:selectedKeys': [keys: string[]];
    toggleKey: [key: string];
    selectAllDisplayed: [];
    clearSelection: [];
    removeTagFromFile: [payload: { key: string; tagId: string }];
  }>();

  /** Cards grid vs tabular explorer layout. */
  const explorerView = ref<'cards' | 'table'>('cards');

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
  let dragTagId: string | null = null;
  let dragSourceKey: string | null = null;

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

  /**
   * "Analyzed" iff the parent has recorded at least one workflow tag association for this
   * file (via the data tagging system's per-run workflow tag). The mapping is sparse — files
   * whose key is missing from the prop are treated as not analyzed, which matches the
   * pre-existing UI default.
   */
  function fileAnalysisStatus(key: string): 'Not yet analyzed' | 'Analyzed' {
    const ids = props.keyToWorkflowTagIds?.[key];
    return ids && ids.length > 0 ? 'Analyzed' : 'Not yet analyzed';
  }

  /** No file objects returned for this listing (under lab prefix). */
  const noObjectsUnderLabPrefix = computed(() => !props.loading && props.listingFileCount === 0);
  const allFilesHiddenByFilters = computed(
    () => !props.loading && props.listingFileCount > 0 && props.visibleFiles.length === 0,
  );

  const batchTagsResolved = computed(() => props.batchTags ?? []);

  const keyToBatchResolved = computed(() => props.keyToBatchTagId ?? {});

  /** Group visible files by batch for section headers (single scroll, not nested folders). */
  const fileSections = computed(() => {
    type Row = (typeof props.visibleFiles)[number];
    const nameById = new Map<string, string>(
      batchTagsResolved.value.map((t: LaboratoryDataTag) => [t.TagId, t.Name] as [string, string]),
    );
    const groups = new Map<string | null, Row[]>();
    for (const f of props.visibleFiles) {
      const bid = keyToBatchResolved.value[f.Key] ?? null;
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid)!.push(f);
    }
    const batchEntries = [...groups.entries()].filter(([k]) => k !== null) as [string, Row[]][];
    batchEntries.sort((a, b) => {
      const na = nameById.get(a[0]) ?? a[0];
      const nb = nameById.get(b[0]) ?? b[0];
      return na.localeCompare(nb);
    });
    const sections: { batchId: string | null; title: string; files: Row[] }[] = [];
    const unbatched = groups.get(null);
    if (unbatched?.length) {
      sections.push({ batchId: null, title: 'Unbatched', files: unbatched });
    }
    for (const [bid, files] of batchEntries) {
      sections.push({
        batchId: bid,
        title: nameById.get(bid) ?? bid,
        files,
      });
    }
    return sections;
  });

  function batchDisplayName(key: string): string {
    const bid = keyToBatchResolved.value[key];
    if (!bid) return '—';
    const tag = batchTagsResolved.value.find((b: LaboratoryDataTag) => b.TagId === bid);
    return tag?.Name ?? bid;
  }

  function batchSectionHeading(sec: {
    batchId: string | null;
    title: string;
    files: readonly { Key: string }[];
  }): string {
    const n = sec.files.length;
    const samples = n === 1 ? 'sample' : 'samples';
    if (sec.batchId === null) {
      return `Unbatched · ${n} ${samples}`;
    }
    return `Batch ${sec.title} · ${n} ${samples}`;
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
      (el as HTMLElement).classList.toggle('ring-2', hit);
      (el as HTMLElement).classList.toggle('ring-primary', hit);
      (el as HTMLElement).classList.toggle('bg-primary-muted', hit);
    });
  }

  function onWindowMouseUp(): void {
    if (!lassoActive.value) return;
    lassoActive.value = false;
    lassoStyle.value = { ...lassoStyle.value, display: 'none' };
    const added: string[] = [];
    scrollEl.value?.querySelectorAll('[data-file-card]').forEach((el) => {
      const h = el as HTMLElement;
      if (h.classList.contains('ring-primary')) {
        const id = h.dataset.key;
        if (id) added.push(id);
      }
      h.classList.remove('ring-2', 'ring-primary', 'bg-primary-muted');
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

  function onCardDragStart(e: DragEvent, key: string): void {
    dragTagId = null;
    dragSourceKey = null;
    const keys = props.selectedKeys.includes(key) ? [...props.selectedKeys] : [key];
    e.dataTransfer?.setData('application/x-eg-keys', JSON.stringify(keys));
    e.dataTransfer?.setData('text/plain', 'keys');
  }

  function onPillDragStart(e: DragEvent, tagId: string, key: string): void {
    e.stopPropagation();
    dragTagId = tagId;
    dragSourceKey = key;
    e.dataTransfer?.setData('text/plain', 'tag');
  }

  function onCardDragOver(e: DragEvent): void {
    if (!dragTagId) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add('outline', 'outline-2', 'outline-red-400');
  }

  function onCardDragLeave(e: DragEvent): void {
    (e.currentTarget as HTMLElement).classList.remove('outline', 'outline-2', 'outline-red-400');
  }

  function onCardDrop(e: DragEvent): void {
    (e.currentTarget as HTMLElement).classList.remove('outline', 'outline-2', 'outline-red-400');
    if (!dragTagId || !dragSourceKey) return;
    e.preventDefault();
    emit('removeTagFromFile', { key: dragSourceKey, tagId: dragTagId });
    dragTagId = null;
    dragSourceKey = null;
  }
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="border-border-muted flex flex-wrap items-center gap-3 border-b px-4 py-3">
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
          Select all ({{ visibleFiles.length }})
        </UButton>
      </div>
    </div>
    <div v-if="listingTruncated" class="border-border-muted border-b bg-amber-50 px-4 py-2 text-xs text-amber-950">
      More objects exist under this prefix than are loaded here. Showing {{ listingFileCount }} file(s); the server
      stops at a safety limit for very large buckets. Use search and tags to work with this subset, or ask for a higher
      listing limit.
    </div>

    <div ref="scrollEl" class="relative flex-1 overflow-auto p-4" @mousedown="onScrollHostMouseDown">
      <div v-if="explorerView === 'cards'" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <template v-for="(sec, secIdx) in fileSections" :key="sec.batchId ?? 'unbatched'">
          <div
            class="border-border-muted col-span-full flex items-start justify-between gap-3 border-b pb-2"
            :class="secIdx === 0 ? 'mt-0' : 'mt-6'"
          >
            <h3 class="text-muted min-w-0 flex-1 text-xs font-normal leading-snug tracking-wide">
              {{ batchSectionHeading(sec) }}
            </h3>
            <button
              type="button"
              class="text-primary shrink-0 text-xs font-normal hover:underline"
              @click.stop="toggleBatchSection(sec)"
            >
              {{ batchSectionFullySelected(sec) ? 'Deselect batch' : 'Select batch' }}
            </button>
          </div>
          <div
            v-for="f in sec.files"
            :key="f.Key"
            data-file-card
            :data-key="f.Key"
            draggable="true"
            class="border-border-muted relative cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition"
            :class="{ 'ring-primary ring-2': selectedKeys.includes(f.Key) }"
            @click="emit('toggleKey', f.Key)"
            @dragstart="onCardDragStart($event, f.Key)"
            @dragover="onCardDragOver"
            @dragleave="onCardDragLeave"
            @drop="onCardDrop($event)"
          >
            <div class="absolute right-2 top-2" @mousedown.stop @click.stop>
              <UCheckbox :model-value="selectedKeys.includes(f.Key)" @update:model-value="emit('toggleKey', f.Key)" />
            </div>
            <div class="pr-8 text-sm font-medium leading-snug">{{ fileName(f.Key) }}</div>
            <div v-if="folderPathUnderLab(f.Key)" class="text-muted mt-0.5 truncate text-[11px]">
              {{ folderPathUnderLab(f.Key) }}
            </div>
            <div class="text-muted mt-1 text-xs">{{ f.Size != null ? `${f.Size} bytes` : '' }}</div>
            <div class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="tid in keyToTagIds[f.Key] || []"
                :key="tid"
                class="inline-flex cursor-grab items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                draggable="true"
                :style="{
                  background: tagById(tid)?.ColorHex || '#e2e2e8',
                  color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                }"
                @dragstart="onPillDragStart($event, tid, f.Key)"
                @click.stop
              >
                {{ tagById(tid)?.Name || tid }}
              </span>
            </div>
          </div>
        </template>
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table class="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead>
            <tr class="border-border-muted bg-gray-50/90 text-xs uppercase tracking-wide text-gray-600">
              <th class="border-border-muted w-10 border-b px-3 py-2.5" scope="col" />
              <th class="border-border-muted border-b px-3 py-2.5 font-semibold" scope="col">Sample ID</th>
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
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-muted min-w-0 flex-1 truncate text-xs font-normal leading-snug tracking-wide">
                      {{ batchSectionHeading(sec) }}
                    </span>
                    <button
                      type="button"
                      class="text-primary shrink-0 text-xs font-normal hover:underline"
                      @click.stop="toggleBatchSection(sec)"
                    >
                      {{ batchSectionFullySelected(sec) ? 'Deselect batch' : 'Select batch' }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr
                v-for="f in sec.files"
                :key="f.Key"
                data-file-card
                :data-key="f.Key"
                draggable="true"
                class="border-border-muted cursor-pointer border-b transition last:border-b-0"
                :class="{
                  'bg-primary-muted/50': selectedKeys.includes(f.Key),
                  'hover:bg-gray-50/80': !selectedKeys.includes(f.Key),
                }"
                @click="emit('toggleKey', f.Key)"
                @dragstart="onCardDragStart($event, f.Key)"
                @dragover="onCardDragOver"
                @dragleave="onCardDragLeave"
                @drop="onCardDrop($event)"
              >
                <td class="px-3 py-2 align-middle" @mousedown.stop @click.stop>
                  <UCheckbox
                    :model-value="selectedKeys.includes(f.Key)"
                    @update:model-value="emit('toggleKey', f.Key)"
                  />
                </td>
                <td class="max-w-[14rem] px-3 py-2 align-middle">
                  <div class="font-medium text-gray-900">{{ fileName(f.Key) }}</div>
                  <div v-if="folderPathUnderLab(f.Key)" class="text-muted truncate text-xs">
                    {{ folderPathUnderLab(f.Key) }}
                  </div>
                </td>
                <td class="text-muted px-3 py-2 align-middle">{{ batchDisplayName(f.Key) }}</td>
                <td class="px-3 py-2 align-middle text-gray-800">{{ fileAnalysisStatus(f.Key) }}</td>
                <td class="px-3 py-2 align-middle">
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="tid in keyToTagIds[f.Key] || []"
                      :key="tid"
                      class="inline-flex cursor-grab items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                      draggable="true"
                      :style="{
                        background: tagById(tid)?.ColorHex || '#e2e2e8',
                        color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                      }"
                      @dragstart="onPillDragStart($event, tid, f.Key)"
                      @click.stop
                    >
                      {{ tagById(tid)?.Name || tid }}
                    </span>
                  </div>
                </td>
                <td class="text-muted px-3 py-2 align-middle">—</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="noObjectsUnderLabPrefix" class="text-muted mx-auto max-w-lg space-y-3 py-12 text-center text-sm">
        <p class="font-medium text-gray-900">No files found under this lab’s prefix in this bucket</p>
      </div>
      <div v-else-if="allFilesHiddenByFilters" class="text-muted py-8 text-center text-sm">
        No files match your current search or tag filter. Clear the search box or choose "All files" or "Untagged" in
        the tag list.
      </div>
      <div
        class="border-primary bg-primary/10 pointer-events-none fixed z-[9999] rounded border-2"
        :style="lassoStyle"
      />
    </div>
  </div>
</template>
