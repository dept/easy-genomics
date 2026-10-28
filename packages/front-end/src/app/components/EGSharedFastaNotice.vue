<script setup lang="ts">
  import type { SharedFastaLocation } from '@FE/utils/data-collections-source-listing';

  defineProps<{
    files: SharedFastaLocation[];
    noticeClass?: string;
  }>();
</script>

<template>
  <div
    v-if="files.length"
    class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"
    :class="noticeClass"
    role="status"
  >
    <p>
      <strong>{{ files.length }}</strong>
      FASTA file(s) match no sample, so no sample will hold them.
    </p>
    <p class="mt-1">
      To use one for the whole run, for example as a reference genome, paste its S3 URI into the workflow's parameter on
      the run's Edit Parameters step. A FASTA joins a sample only when its name without the extension is the sample ID,
      for example A.fasta with A_R1.fastq.gz and A_R2.fastq.gz.
    </p>
    <ul class="mt-2 max-h-40 space-y-1 overflow-y-auto">
      <li v-for="file in files" :key="file.uri" class="flex items-center gap-1">
        <span class="break-all font-mono">{{ file.uri }}</span>
        <EGCopyButton :value="file.uri" :label="`Copy the S3 URI of ${file.name}`" />
      </li>
    </ul>
  </div>
</template>
