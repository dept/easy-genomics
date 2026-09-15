<script setup lang="ts">
  import { basenameFromS3Key } from '@FE/utils/data-collections-file-type';

  defineProps<{
    unmatchedFiles: string[];
    proposedSetCount: number;
    noticeClass?: string;
  }>();
</script>

<template>
  <div
    v-if="unmatchedFiles.length"
    class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
    :class="noticeClass"
  >
    <strong>{{ unmatchedFiles.length }}</strong>
    file(s) did not match the pattern and will be skipped:
    <span class="mt-1 block truncate font-mono">{{ unmatchedFiles.map(basenameFromS3Key).join(', ') }}</span>
    <p v-if="proposedSetCount === 0" class="mt-2">
      None of the selected files match the grouping regex. Please modify the regex or the files selected and try again.
    </p>
  </div>
</template>
