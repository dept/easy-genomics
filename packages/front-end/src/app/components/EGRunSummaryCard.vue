<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { getDate, getTime } from '@FE/utils/date-time';
  import { formatRunDuration } from '@FE/utils/run-duration';

  const props = defineProps<{ labRun: LaboratoryRun }>();

  const runtime = computed<string | null>(() => formatRunDuration(props.labRun.RunDurationSeconds));

  /** `TerminalAt` is set for every terminal status, so the label follows the status. */
  const terminalLabel = computed<string>(() =>
    props.labRun.Status?.toUpperCase() === 'FAILED' ? 'Failed' : 'Finished',
  );

  const isFailed = computed<boolean>(() => props.labRun.Status?.toUpperCase() === 'FAILED');

  /**
   * `CreatedAt` is present on every run in practice but optional in the type, so
   * guard against a card that renders nothing but a heading.
   */
  const hasContent = computed<boolean>(() => !!runtime.value || !!props.labRun.CreatedAt || !!props.labRun.TerminalAt);

  function timestamp(value: string | null | undefined): string | null {
    const time = getTime(value);
    const date = getDate(value);
    return time && date ? `${time} ⋅ ${date}` : null;
  }
</script>

<template>
  <section
    v-if="hasContent"
    class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
  >
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Summary</h3>

    <dl class="space-y-0">
      <div v-if="runtime" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">Total runtime</dt>
        <dd class="text-lg font-semibold text-black">{{ runtime }}</dd>
      </div>

      <div v-if="timestamp(labRun.CreatedAt)" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">Created</dt>
        <dd class="text-sm text-black">{{ timestamp(labRun.CreatedAt) }}</dd>
      </div>

      <div v-if="timestamp(labRun.TerminalAt)" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">{{ terminalLabel }}</dt>
        <dd class="text-sm" :class="isFailed ? 'font-medium text-red-700' : 'text-black'">
          {{ timestamp(labRun.TerminalAt) }}
        </dd>
      </div>

      <EGRunCostRow :lab-run="labRun" variant="summary" />
    </dl>
  </section>
</template>
