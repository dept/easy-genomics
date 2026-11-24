<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { format, isValid } from 'date-fns';
  import { formatCompactDateTime } from '@FE/utils/date-time';

  const props = withDefaults(
    defineProps<{
      labRun: LaboratoryRun;
      /** omics = HealthOmics overview redesign fields; legacy = previous Details card. */
      variant?: 'legacy' | 'omics';
    }>(),
    { variant: 'legacy' },
  );

  const isOmics = computed(() => props.variant === 'omics');

  const externalRunIdLabel = computed<string>(() =>
    props.labRun.Platform === 'AWS HealthOmics' ? 'HealthOmics run ID' : 'External run ID',
  );

  const lastModified = computed<string | null>(() => formatCompactDateTime(props.labRun.ModifiedAt));

  const resultsKeptUntil = computed<string | null>(() => {
    const epoch = props.labRun.ExpiresAt;
    if (epoch == null || !Number.isFinite(epoch)) return null;
    const date = new Date(epoch * 1000);
    if (!isValid(date)) return null;
    return format(date, 'd MMM yyyy');
  });

  const ownerLabel = computed(() => (isOmics.value ? 'Started by' : 'Owner'));
</script>

<template>
  <section class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5">
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Details</h3>

    <dl class="space-y-0">
      <div v-if="labRun.Owner" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted shrink-0 text-sm">{{ ownerLabel }}</dt>
        <dd class="min-w-0 break-all text-right text-sm text-black">{{ labRun.Owner }}</dd>
      </div>

      <div v-if="!isOmics && labRun.Platform" class="flex items-baseline justify-between gap-4 border-b py-3">
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

      <div
        class="flex items-baseline justify-between gap-4 border-b py-3"
        :class="{ 'border-b-0': isOmics && !resultsKeptUntil }"
      >
        <dt class="text-muted shrink-0 text-sm">Easy Genomics ID</dt>
        <dd class="min-w-0 text-right text-sm text-black">
          <span class="inline-flex items-center justify-end gap-1">
            <span class="break-all font-mono text-xs">{{ labRun.RunId }}</span>
            <EGCopyButton :value="labRun.RunId" label="Copy Easy Genomics ID" />
          </span>
        </dd>
      </div>

      <div v-if="isOmics && resultsKeptUntil" class="flex items-baseline justify-between gap-4 py-3">
        <dt class="text-muted shrink-0 text-sm">Results kept until</dt>
        <dd class="text-right text-sm text-black">{{ resultsKeptUntil }}</dd>
      </div>

      <div v-if="!isOmics && lastModified" class="flex items-baseline justify-between gap-4 py-3">
        <dt class="text-muted shrink-0 text-sm">Last modified</dt>
        <dd class="text-right text-sm text-black">{{ lastModified }}</dd>
      </div>
    </dl>
  </section>
</template>
