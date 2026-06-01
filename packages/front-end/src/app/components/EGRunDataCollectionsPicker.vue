<script setup lang="ts">
  import { useLaboratoryDataCollections } from '@FE/composables/useLaboratoryDataCollections';

  const props = defineProps<{
    labId: string;
    /** S3 keys already added to the run. */
    addedKeys: string[];
  }>();

  const emit = defineEmits<{
    'add-to-run': [keys: string[]];
  }>();

  const labIdRef = toRef(() => props.labId);

  const dc = useLaboratoryDataCollections(labIdRef, { pickerMode: true });

  const {
    lab,
    labRoot,
    tags,
    keyToTagIds,
    keyToBatchTagId,
    keyToWorkflowTagIds,
    keyToIsPermanent,
    keyToRunUsages,
    keyToStandardTagIdsForExplorer,
    selectedKeys,
    tagsFilterUntagged,
    tagsFilterTagIds,
    search,
    fileTypeFilterEnabled,
    loading,
    batchTags,
    visibleFiles,
    files,
    listingTruncated,
    fileTypeCounts,
    hiddenByFileTypeCount,
    hiddenByFileTypeBreakdown,
    leftRailTagFilterTags,
    standardTagIdToChipCount,
    untaggedChipCount,
    allSamplesChipCount,
    toggleKey,
    selectAllDisplayed,
    clearSelection,
    isUntaggedTagFilterActive,
    isStandardTagFilterActive,
    onUntaggedTagFilterClick,
    onStandardTagFilterClick,
    tagById,
  } = dc;

  const addedKeySet = computed(() => new Set(props.addedKeys));

  const canAddToRun = computed(() => selectedKeys.value.length > 0);

  function onAddToRun(): void {
    const keys = selectedKeys.value.filter((k) => !addedKeySet.value.has(k));
    if (!keys.length) return;
    emit('add-to-run', keys);
    clearSelection();
  }

  const isAllTagsFilterActive = computed(() => !tagsFilterUntagged.value && tagsFilterTagIds.value.length === 0);

  function onAllSamplesFilterClick(): void {
    tagsFilterUntagged.value = false;
    tagsFilterTagIds.value = [];
  }
</script>

<template>
  <div class="flex h-[520px] overflow-hidden rounded-lg border border-gray-200 bg-white">
    <nav class="border-border-muted flex w-[210px] shrink-0 flex-col border-r bg-gray-50/80" aria-label="Filter by tag">
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <p class="text-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">Filter by tag</p>
        <button
          type="button"
          class="hover:bg-primary-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
          :class="{ 'bg-primary-muted': isAllTagsFilterActive }"
          @click="onAllSamplesFilterClick"
        >
          <span class="text-body font-medium">All samples</span>
          <span class="text-muted rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] tabular-nums">
            {{ allSamplesChipCount }}
          </span>
        </button>
        <button
          type="button"
          class="mt-1 flex w-full items-center justify-between rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-1.5 text-left text-xs"
          :class="{ 'bg-amber-200': isUntaggedTagFilterActive() }"
          @click="onUntaggedTagFilterClick"
        >
          <span class="font-medium text-amber-950">Untagged</span>
          <span class="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-950">
            {{ untaggedChipCount }}
          </span>
        </button>
        <button
          v-for="t in leftRailTagFilterTags"
          :key="t.TagId"
          type="button"
          class="hover:bg-primary-muted flex w-full items-center justify-between gap-1 rounded-md px-2 py-1.5 text-left text-xs"
          :class="{ 'bg-primary-muted': isStandardTagFilterActive(t.TagId) }"
          @click="onStandardTagFilterClick(t.TagId)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: t.ColorHex }" />
            <span class="truncate">{{ t.Name }}</span>
          </span>
          <span class="text-muted shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] tabular-nums">
            {{ standardTagIdToChipCount[t.TagId] ?? 0 }}
          </span>
        </button>
      </div>
    </nav>

    <div class="flex min-w-0 flex-1 flex-col">
      <EGDataCollectionsExplorer
        :lab-id="labId"
        :lab-root="labRoot"
        :s3-bucket="lab?.S3Bucket"
        :visible-files="visibleFiles"
        :key-to-tag-ids="keyToTagIds"
        :key-to-batch-tag-id="keyToBatchTagId"
        :key-to-workflow-tag-ids="keyToWorkflowTagIds"
        :key-to-is-permanent="keyToIsPermanent"
        :key-to-run-usages="keyToRunUsages"
        :batch-tags="batchTags"
        :tags="tags"
        :selected-keys="selectedKeys"
        :loading="loading"
        :search="search"
        :listing-file-count="files.length"
        :listing-truncated="listingTruncated"
        :file-type-filter="fileTypeFilterEnabled"
        :file-type-counts="fileTypeCounts"
        :hidden-by-file-type-count="hiddenByFileTypeCount"
        :hidden-by-file-type-breakdown="hiddenByFileTypeBreakdown"
        table-only
        hide-file-type-filter
        :disabled-keys="addedKeys"
        disable-drag
        @update:search="search = $event"
        @update:selected-keys="selectedKeys = $event"
        @toggle-key="toggleKey"
        @select-all-displayed="selectAllDisplayed"
        @clear-selection="clearSelection"
      />
      <div
        class="border-border-muted flex shrink-0 items-center justify-between border-t bg-white px-4 py-2.5"
        aria-label="Add selected files to run"
      >
        <p class="text-muted text-xs">
          <strong class="text-body">{{ selectedKeys.length }}</strong>
          selected
        </p>
        <EGButton label="Add to run" size="sm" :disabled="!canAddToRun" @click="onAddToRun" />
      </div>
    </div>
  </div>
</template>
