<script setup lang="ts">
  export type DataCollectionsTab = 'collections' | 'samples' | 'files';

  defineProps<{
    activeTab: DataCollectionsTab;
    collectionCount: number;
    sampleCount: number;
    fileCount: number;
  }>();

  const emit = defineEmits<{ 'update:activeTab': [tab: DataCollectionsTab] }>();

  const tabs: { key: DataCollectionsTab; label: string }[] = [
    { key: 'samples', label: 'Samples' },
    { key: 'collections', label: 'Sequence Collections' },
    { key: 'files', label: 'Files' },
  ];
</script>

<template>
  <div class="mb-4 flex border-b border-gray-200">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
      :class="
        activeTab === tab.key
          ? 'border-primary text-primary-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      "
      @click="emit('update:activeTab', tab.key)"
    >
      {{ tab.label }}
      <span class="ml-1 font-normal text-gray-400">
        ·
        {{ tab.key === 'collections' ? collectionCount : tab.key === 'samples' ? sampleCount : fileCount }}
      </span>
    </button>
  </div>
</template>
