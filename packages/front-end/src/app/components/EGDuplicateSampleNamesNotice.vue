<script setup lang="ts">
  import {
    type DuplicateSampleName,
    folderBelowLabRoot,
  } from '@easy-genomics/shared-lib/src/app/utils/sample-regex-grouping';

  defineProps<{
    duplicates: DuplicateSampleName[];
    noticeClass?: string;
  }>();
</script>

<template>
  <div
    v-if="duplicates.length"
    class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
    :class="noticeClass"
  >
    <strong>{{ duplicates.length }}</strong>
    sample name(s) appear in more than one folder. Each folder becomes its own sample with the same name. Samples
    sharing a name can't be run in the same data collection, because the sample sheet rejects duplicate sample_ids.
    Exclude any you do not want to import.
    <ul class="mt-1 max-h-32 space-y-1 overflow-y-auto">
      <li v-for="duplicate in duplicates" :key="duplicate.sampleId">
        <span class="font-medium">{{ duplicate.sampleId }}</span>
        <span class="break-all font-mono">
          — {{ duplicate.folders.map((folder) => folderBelowLabRoot(folder) || '(lab root)').join(', ') }}
        </span>
      </li>
    </ul>
  </div>
</template>
