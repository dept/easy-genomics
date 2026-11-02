<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

  const props = defineProps<{ labRun: LaboratoryRun; labName: string; labId: string }>();

  /** Trailing segment of the S3 key; falls back to the whole URL for directory-style URIs. */
  const fileName = computed<string>(() => {
    const url = props.labRun.SampleSheetS3Url ?? '';
    const lastSegment = url.split('/').filter(Boolean).pop();
    return lastSegment || url;
  });
</script>

<template>
  <section
    v-if="labRun.SampleSheetS3Url"
    class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
  >
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Input</h3>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 text-sm font-medium text-black">
          <UIcon name="i-heroicons-document-text" class="shrink-0" aria-hidden="true" />
          <span class="break-all">{{ fileName }}</span>
        </p>
        <p class="text-muted mt-2 break-all font-mono text-xs">{{ labRun.SampleSheetS3Url }}</p>
      </div>

      <EGS3SampleSheetBar
        :url="labRun.SampleSheetS3Url"
        :lab-id="labId"
        :lab-name="labName"
        :pipeline-or-workflow-name="labRun.WorkflowName"
        :platform="labRun.Platform"
        :run-name="labRun.RunName"
        :display-label="false"
        icons-only
      />
    </div>
  </section>
</template>
