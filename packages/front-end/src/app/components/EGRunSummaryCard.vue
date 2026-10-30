<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { formatCompactDateTime } from '@FE/utils/date-time';
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

  const startedAt = computed<string | null>(() => formatCompactDateTime(props.labRun.CreatedAt));
  const finishedAt = computed<string | null>(() => formatCompactDateTime(props.labRun.TerminalAt));
</script>

<template>
  <section
    v-if="hasContent"
    class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
  >
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Summary</h3>

    <dl class="space-y-0">
      <div v-if="runtime" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">Runtime</dt>
        <dd class="text-lg font-semibold text-black">{{ runtime }}</dd>
      </div>

      <div v-if="startedAt" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">Started</dt>
        <dd class="text-sm text-black">{{ startedAt }}</dd>
      </div>

      <div v-if="finishedAt" class="flex items-baseline justify-between gap-4 border-b py-3">
        <dt class="text-muted text-sm">{{ terminalLabel }}</dt>
        <dd class="text-sm" :class="isFailed ? 'font-medium text-red-700' : 'text-black'">
          {{ finishedAt }}
        </dd>
      </div>

      <EGRunCostRow :lab-run="labRun" variant="summary" />
    </dl>
  </section>
</template>
