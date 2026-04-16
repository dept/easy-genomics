<script setup lang="ts">
  import type { DataCollectionTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { useDataCollectionLasso } from '@FE/composables/useDataCollectionLasso';
  import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
  }>();

  const { $api } = useNuxtApp();

  const labsStore = useLabsStore();
  const toastStore = useToastStore();
  const uiStore = useUiStore();

  const lab = computed<Laboratory | null>(() => labsStore.labs[props.labId] ?? null);
  const s3Bucket = computed(() => lab.value?.S3Bucket ?? '');
  const s3Prefix = computed(() => (lab.value ? `${lab.value.OrganizationId}/${lab.value.LaboratoryId}/` : ''));

  const tagDefinitions = ref<DataCollectionTag[]>([]);
  const tagsByS3Key = ref<Record<string, { TagId: string; Name: string; Color: string }[]>>({});
  const visibleFileKeys = ref<string[]>([]);

  const selectedKeys = ref<string[]>([]);
  const tagFilter = ref<'all' | 'untagged' | string>('all');
  const bulkTagIds = ref<string[]>([]);

  const showNewTag = ref(false);
  const newTagName = ref('');
  const newTagColor = ref('#5B4FD4');
  const tagsReady = ref(false);

  const SWATCHES = ['#5B4FD4', '#97C459', '#ED93B1', '#85B7EB', '#F09595', '#EF9F27', '#B4B2A9'];

  const tagCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const t of tagDefinitions.value) {
      counts[t.TagId] = 0;
    }
    let untagged = 0;
    for (const key of visibleFileKeys.value) {
      const tags = tagsByS3Key.value[key] ?? [];
      if (tags.length === 0) untagged += 1;
      for (const x of tags) {
        counts[x.TagId] = (counts[x.TagId] ?? 0) + 1;
      }
    }
    return { counts, untagged, total: visibleFileKeys.value.length };
  });

  async function refreshTagDefinitions() {
    const res = await $api.dataCollection.listDataCollectionTags(props.labId);
    tagDefinitions.value = res.Tags;
  }

  async function hydrateAssignmentsForKeys(keys: string[]) {
    if (!keys.length) return;
    const res = await $api.dataCollection.requestBatchGetDataCollectionFileTags({
      LaboratoryId: props.labId,
      S3Keys: keys,
    });
    const map = new Map(tagDefinitions.value.map((t) => [t.TagId, t]));
    const next = { ...tagsByS3Key.value };
    for (const a of res.Assignments) {
      next[a.S3Key] = a.TagIds.map((id) => map.get(id))
        .filter((x): x is DataCollectionTag => !!x)
        .map((t) => ({
          TagId: t.TagId,
          Name: t.Name,
          Color: t.Color,
        }));
    }
    tagsByS3Key.value = next;
  }

  async function onVisibleFileKeysChange(keys: string[]) {
    visibleFileKeys.value = keys;
    if (!keys.length) return;
    try {
      await hydrateAssignmentsForKeys(keys);
    } catch (e) {
      console.error(e);
      toastStore.error('Failed to load tags for files');
    }
  }

  const explorerArea = ref<HTMLElement | null>(null);
  const { lassoBox, onMouseDown: onLassoMouseDown } = useDataCollectionLasso(explorerArea, (keys) => {
    const set = new Set([...selectedKeys.value, ...keys]);
    selectedKeys.value = [...set];
  });

  async function applyTagsToSelection() {
    if (!selectedKeys.value.length || !bulkTagIds.value.length) {
      toastStore.error('Select files and at least one tag');
      return;
    }
    uiStore.setRequestPending('dataCollectionBulkTag');
    try {
      const items = selectedKeys.value.map((s3Key) => {
        const existing = new Set((tagsByS3Key.value[s3Key] ?? []).map((t) => t.TagId));
        for (const id of bulkTagIds.value) existing.add(id);
        return { S3Key: s3Key, TagIds: [...existing] };
      });
      await $api.dataCollection.requestBatchSetDataCollectionFileTags({
        LaboratoryId: props.labId,
        Items: items,
      });
      toastStore.success('Tags updated');
      await refreshTagDefinitions();
      await hydrateAssignmentsForKeys(visibleFileKeys.value);
    } catch (e) {
      console.error(e);
      toastStore.error('Failed to update tags');
    } finally {
      uiStore.setRequestComplete('dataCollectionBulkTag');
    }
  }

  async function createTag() {
    if (!newTagName.value.trim()) return;
    uiStore.setRequestPending('dataCollectionCreateTag');
    try {
      await $api.dataCollection.createDataCollectionTag({
        LaboratoryId: props.labId,
        Name: newTagName.value.trim(),
        Color: newTagColor.value,
      });
      toastStore.success('Tag created');
      showNewTag.value = false;
      newTagName.value = '';
      await refreshTagDefinitions();
      await hydrateAssignmentsForKeys(visibleFileKeys.value);
    } catch (e) {
      console.error(e);
      toastStore.error('Failed to create tag');
    } finally {
      uiStore.setRequestComplete('dataCollectionCreateTag');
    }
  }

  async function removeTag(tagId: string) {
    uiStore.setRequestPending('dataCollectionRemoveTag');
    try {
      await $api.dataCollection.removeDataCollectionTag({ LaboratoryId: props.labId, TagId: tagId });
      toastStore.success('Tag removed');
      if (tagFilter.value === tagId) tagFilter.value = 'all';
      await refreshTagDefinitions();
      await hydrateAssignmentsForKeys(visibleFileKeys.value);
    } catch (e) {
      console.error(e);
      toastStore.error('Failed to remove tag');
    } finally {
      uiStore.setRequestComplete('dataCollectionRemoveTag');
    }
  }

  function setTagFilter(id: 'all' | 'untagged' | string) {
    tagFilter.value = id;
  }

  onMounted(async () => {
    uiStore.setRequestPending('loadDataCollectionsLab');
    try {
      if (!lab.value) {
        await labsStore.loadLab(props.labId);
      }
      await refreshTagDefinitions();
      tagsReady.value = true;
    } catch (e) {
      console.error(e);
      toastStore.error('Failed to load lab');
    } finally {
      uiStore.setRequestComplete('loadDataCollectionsLab');
    }
  });
</script>

<template>
  <div v-if="lab && s3Bucket" class="flex min-h-0 flex-1 flex-col">
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] lg:gap-6">
      <aside class="bg-background-light-grey flex flex-col rounded-2xl border border-gray-200 p-3 lg:min-h-[420px]">
        <p class="text-muted mb-2 text-[10px] font-medium uppercase tracking-wide">Filter by tag</p>
        <button
          type="button"
          class="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors"
          :class="tagFilter === 'all' ? 'bg-primary-muted text-primary-dark font-medium' : 'hover:bg-gray-100'"
          @click="setTagFilter('all')"
        >
          <span>All files</span>
          <span class="text-muted text-xs">{{ tagCounts.total }}</span>
        </button>
        <button
          v-for="t in tagDefinitions"
          :key="t.TagId"
          type="button"
          class="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors"
          :class="tagFilter === t.TagId ? 'bg-primary-muted text-primary-dark font-medium' : 'hover:bg-gray-100'"
          @click="setTagFilter(t.TagId)"
        >
          <span class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: t.Color }" />
            {{ t.Name }}
          </span>
          <span class="text-muted text-xs">{{ tagCounts.counts[t.TagId] ?? 0 }}</span>
        </button>
        <button
          type="button"
          class="mb-2 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors"
          :class="tagFilter === 'untagged' ? 'bg-primary-muted text-primary-dark font-medium' : 'hover:bg-gray-100'"
          @click="setTagFilter('untagged')"
        >
          <span>Untagged</span>
          <span class="text-muted text-xs">{{ tagCounts.untagged }}</span>
        </button>

        <div class="border-t border-gray-200 pt-2">
          <button
            type="button"
            class="text-primary mb-2 flex w-full items-center gap-1 text-sm font-medium"
            @click="showNewTag = !showNewTag"
          >
            + New tag
          </button>
          <div v-if="showNewTag" class="space-y-2 rounded-lg border border-gray-200 bg-white p-2">
            <input
              v-model="newTagName"
              type="text"
              placeholder="Tag name"
              class="focus:border-primary w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none"
            />
            <div class="flex flex-wrap gap-1">
              <button
                v-for="c in SWATCHES"
                :key="c"
                type="button"
                class="h-6 w-6 rounded-full border-2"
                :class="newTagColor === c ? 'border-gray-900' : 'border-transparent'"
                :style="{ backgroundColor: c }"
                @click="newTagColor = c"
              />
            </div>
            <EGButton
              label="Create"
              class="w-full"
              :disabled="!newTagName.trim()"
              :loading="uiStore.isRequestPending('dataCollectionCreateTag')"
              @click="createTag"
            />
          </div>
        </div>

        <div class="border-t border-gray-200 pt-2">
          <p class="text-muted mb-1 text-[10px] uppercase">Manage tags</p>
          <div
            v-for="t in tagDefinitions"
            :key="`rm-${t.TagId}`"
            class="flex items-center justify-between gap-2 py-1 text-xs"
          >
            <span class="truncate">{{ t.Name }}</span>
            <button type="button" class="text-red-600 hover:underline" @click="removeTag(t.TagId)">Remove</button>
          </div>
        </div>
      </aside>

      <div class="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div ref="explorerArea" class="relative min-h-[360px] flex-1 overflow-auto p-4" @mousedown="onLassoMouseDown">
          <EGFileExplorer
            v-if="tagsReady"
            :lab-id="labId"
            :s3-bucket="s3Bucket"
            :s3-prefix="s3Prefix"
            selection-mode
            v-model:selected-keys="selectedKeys"
            :tags-by-s3-key="tagsByS3Key"
            :tag-filter="tagFilter"
            @visible-file-keys-change="onVisibleFileKeysChange"
          />
          <div
            v-if="lassoBox.visible"
            class="border-primary bg-primary/10 pointer-events-none absolute z-10 border-2"
            :style="{
              left: `${lassoBox.left}px`,
              top: `${lassoBox.top}px`,
              width: `${lassoBox.width}px`,
              height: `${lassoBox.height}px`,
            }"
          />
        </div>
      </div>
    </div>

    <div class="border-t border-gray-200 bg-white px-4 py-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-muted text-sm">
          <span class="text-body font-medium">{{ selectedKeys.length }}</span>
          file(s) selected
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <USelectMenu
            v-model="bulkTagIds"
            multiple
            :options="tagDefinitions"
            value-attribute="TagId"
            option-attribute="Name"
            placeholder="Tags to apply…"
            class="min-w-[240px]"
          />
          <EGButton
            label="Apply tags"
            :disabled="!selectedKeys.length || !bulkTagIds.length"
            :loading="uiStore.isRequestPending('dataCollectionBulkTag')"
            @click="applyTagsToSelection"
          />
          <EGButton
            variant="secondary"
            label="Clear selection"
            :disabled="!selectedKeys.length"
            @click="selectedKeys = []"
          />
        </div>
      </div>
    </div>
  </div>
  <div v-else class="p-8">
    <EGLoadingSpinner v-if="uiStore.isRequestPending('loadDataCollectionsLab')" />
    <p v-else class="text-muted">Lab not found or missing S3 configuration.</p>
  </div>
</template>
