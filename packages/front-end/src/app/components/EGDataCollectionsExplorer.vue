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

  const scrollEl = ref<HTMLElement | null>(null);
  const lassoActive = ref(false);
  const lassoStyle = ref({
    display: 'none' as const,
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

  /** No file objects returned for this listing (under lab prefix). */
  const noObjectsUnderLabPrefix = computed(() => !props.loading && props.listingFileCount === 0);

  /** Parent still has file rows for this prefix, but search / tag filter hides all of them. */
  const allFilesHiddenByFilters = computed(
    () => !props.loading && props.listingFileCount > 0 && props.visibleFiles.length === 0,
  );

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
      <div class="flex shrink-0">
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
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div
          v-for="f in visibleFiles"
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
