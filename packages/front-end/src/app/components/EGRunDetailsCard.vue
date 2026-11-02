<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { formatCompactDateTime } from '@FE/utils/date-time';

  const props = defineProps<{ labRun: LaboratoryRun }>();

  const externalRunIdLabel = computed<string>(() =>
    props.labRun.Platform === 'AWS HealthOmics' ? 'HealthOmics run ID' : 'External run ID',
  );

  const lastModified = computed<string | null>(() => formatCompactDateTime(props.labRun.ModifiedAt));
</script>

<template>
  <section class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5">
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Details</h3>

    <dl class="space-y-0">
      <div v-if="labRun.Owner" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted shrink-0 text-sm">Owner</dt>
        <dd class="min-w-0 break-all text-right text-sm text-black">{{ labRun.Owner }}</dd>
      </div>

      <div v-if="labRun.Platform" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted shrink-0 text-sm">Platform</dt>
        <dd class="text-right text-sm text-black">{{ labRun.Platform }}</dd>
      </div>

      <div v-if="labRun.ExternalRunId" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted shrink-0 text-sm">{{ externalRunIdLabel }}</dt>
        <dd class="min-w-0 text-right text-sm text-black">
          <span class="inline-flex items-center justify-end gap-1">
            <span class="break-all font-mono text-xs">{{ labRun.ExternalRunId }}</span>
            <EGCopyButton :value="labRun.ExternalRunId" :label="`Copy ${externalRunIdLabel}`" />
          </span>
        </dd>
      </div>

      <div class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted shrink-0 text-sm">Easy Genomics ID</dt>
        <dd class="min-w-0 text-right text-sm text-black">
          <span class="inline-flex items-center justify-end gap-1">
            <span class="break-all font-mono text-xs">{{ labRun.RunId }}</span>
            <EGCopyButton :value="labRun.RunId" label="Copy Easy Genomics ID" />
          </span>
        </dd>
      </div>

      <div v-if="lastModified" class="flex items-baseline justify-between gap-4 py-3">
        <dt class="text-muted shrink-0 text-sm">Last modified</dt>
        <dd class="text-right text-sm text-black">{{ lastModified }}</dd>
      </div>
    </dl>
  </section>
</template>
