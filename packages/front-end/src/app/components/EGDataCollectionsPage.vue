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
  const files = ref<{ Key: string; Size?: number; LastModified?: string }[]>([]);
  const listingTruncated = ref(false);
  const selectedKeys = ref<string[]>([]);
  const filterTagId = ref<string | null>(null);
  const search = ref('');
  const newTagName = ref('');
  const newTagColor = ref('#5B4FD4');
  const showNewTagForm = ref(false);

  const loading = computed(() =>
    uiStore.anyRequestPending(['dataCollectionsList', 'dataCollectionsTags', 'dataCollectionsMutate']),
  );

  function tagById(id: string): LaboratoryDataTag | undefined {
    return tags.value.find((t) => t.TagId === id);
  }

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
      if (keys.length) {
        const tr = await $api.dataCollections.requestListFileTags({
          LaboratoryId: props.labId,
          S3Bucket: lab.value.S3Bucket,
          Keys: keys,
        });
        for (const f of tr.Files) {
          map[f.Key] = f.TagIds;
        }
      }
      keyToTagIds.value = map;
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
      await loadListing();
    },
    { immediate: true },
  );

  onMounted(async () => {
    await loadTags();
  });

  const visibleFiles = computed(() => {
    let list = files.value;
    const q = search.value.trim().toLowerCase();
    if (q) list = list.filter((f) => f.Key.toLowerCase().includes(q));
    if (filterTagId.value === 'untagged') {
      list = list.filter((f) => !keyToTagIds.value[f.Key]?.length);
    } else if (filterTagId.value) {
      list = list.filter((f) => (keyToTagIds.value[f.Key] || []).includes(filterTagId.value!));
    }
    return list;
  });

  function toggleKey(key: string): void {
    const s = new Set(selectedKeys.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    selectedKeys.value = [...s];
  }

  function selectAllVisible(): void {
    selectedKeys.value = visibleFiles.value.map((f) => f.Key);
  }

  async function createTag(): Promise<void> {
    if (!newTagName.value.trim()) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.createTag({
        LaboratoryId: props.labId,
        Name: newTagName.value.trim(),
        ColorHex: newTagColor.value,
      });
      newTagName.value = '';
      showNewTagForm.value = false;
      await loadTags();
      toast.success('Tag created');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Create tag failed: ${msg}`);
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function applyTagToKeys(tagId: string, keys: string[]): Promise<void> {
    if (!lab.value?.S3Bucket || !keys.length) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.addTagsToFiles({
        LaboratoryId: props.labId,
        S3Bucket: lab.value.S3Bucket,
        Keys: keys,
        AddTagIds: [tagId],
      });
      selectedKeys.value = [];
      await loadTags();
      await loadListing();
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

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];
</script>

<template>
  <div v-if="!lab?.S3Bucket" class="text-muted rounded-lg border border-dashed p-8 text-center text-sm">
    This lab has no S3 bucket configured. Set a bucket in Lab Settings to use Data Collections.
  </div>
  <div v-else class="flex min-h-[480px] gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
    <div class="border-border-muted flex w-[280px] shrink-0 flex-col border-r bg-gray-50">
      <div class="border-border-muted border-b p-4">
        <div class="text-muted mb-2 text-xs font-medium uppercase tracking-wide">Tags</div>
        <button
          type="button"
          class="hover:bg-primary-muted flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm"
          :class="{ 'bg-primary-muted font-medium': filterTagId === null }"
          @click="filterTagId = null"
        >
          <span>All files</span>
        </button>
        <button
          type="button"
          class="hover:bg-primary-muted flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm"
          :class="{ 'bg-primary-muted font-medium': filterTagId === 'untagged' }"
          @click="filterTagId = 'untagged'"
        >
          <span>Untagged</span>
        </button>
        <div
          v-for="t in tags"
          :key="t.TagId"
          class="hover:bg-primary-muted flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-left text-sm"
          :class="{ 'bg-primary-muted font-medium': filterTagId === t.TagId }"
          @click="filterTagId = t.TagId"
          @dragover.prevent="onCardDragOverTag"
          @drop="onTagRowDrop($event, t.TagId)"
        >
          <span class="flex items-center gap-2">
            <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
            {{ t.Name }}
          </span>
          <span class="text-muted text-xs">{{ t.FileCount }}</span>
        </div>
        <button
          type="button"
          class="text-primary mt-2 flex items-center gap-1 text-sm font-medium"
          @click="showNewTagForm = !showNewTagForm"
        >
          + New tag
        </button>
        <div v-if="showNewTagForm" class="border-border-muted mt-3 space-y-2 rounded-lg border bg-white p-3">
          <UInput v-model="newTagName" placeholder="Tag name" size="sm" />
          <div class="flex flex-wrap gap-1">
            <button
              v-for="c in presetColors"
              :key="c"
              type="button"
              class="h-7 w-7 rounded border-2"
              :class="newTagColor === c ? 'border-primary' : 'border-transparent'"
              :style="{ background: c }"
              @click="newTagColor = c"
            />
          </div>
          <UInput v-model="newTagColor" placeholder="#RRGGBB" size="sm" />
          <div class="flex gap-2">
            <UButton size="sm" variant="outline" @click="showNewTagForm = false">Cancel</UButton>
            <UButton size="sm" :disabled="!newTagName.trim()" :loading="loading" @click="createTag">Create</UButton>
          </div>
        </div>
      </div>
      <div v-if="selectedKeys.length" class="border-border-muted border-t p-3 text-xs">
        <span class="font-medium">{{ selectedKeys.length }} selected</span>
        <div class="mt-2 flex flex-wrap gap-1">
          <UButton
            v-for="t in tags"
            :key="'a-' + t.TagId"
            size="xs"
            variant="soft"
            :loading="loading"
            @click="applyTagToKeys(t.TagId, selectedKeys)"
          >
            + {{ t.Name }}
          </UButton>
        </div>
      </div>
    </div>

    <EGDataCollectionsExplorer
      :lab-root="labRoot"
      :visible-files="visibleFiles"
      :key-to-tag-ids="keyToTagIds"
      :tags="tags"
      :selected-keys="selectedKeys"
      :loading="loading"
      :search="search"
      :listing-file-count="files.length"
      :listing-truncated="listingTruncated"
      @update:search="search = $event"
      @update:selected-keys="selectedKeys = $event"
      @toggle-key="toggleKey"
      @select-all-visible="selectAllVisible"
      @clear-selection="selectedKeys = []"
      @remove-tag-from-file="removeTagFromFile($event.key, $event.tagId)"
    />
  </div>
</template>
