<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { format, parseISO, isValid } from 'date-fns';
  import { resolveRunCostSource, showRunCostRow } from '@FE/utils/run-cost-row-visibility';
  import { formatCompactDateTime } from '@FE/utils/date-time';
  import { formatRunDuration } from '@FE/utils/run-duration';
  import { isTerminalRunStatus } from '@FE/utils/run-progress-card-visibility';

  const props = withDefaults(
    defineProps<{
      labRun: LaboratoryRun;
      /** Failed Omics task count for the status subtitle. */
      failedTaskCount?: number;
    }>(),
    { failedTaskCount: 0 },
  );

  const statusLabel = computed(() => {
    const raw = props.labRun.Status?.trim() || 'Unknown';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  });

  const isCompleted = computed(() => props.labRun.Status?.toUpperCase() === 'COMPLETED');
  const isFailed = computed(() => props.labRun.Status?.toUpperCase() === 'FAILED');

  const statusDotClass = computed(() => {
    if (isCompleted.value) return 'bg-green-500';
    if (isFailed.value) return 'bg-red-500';
    return 'bg-amber-400';
  });

  const statusSubtext = computed(() => {
    if (isFailed.value && props.failedTaskCount > 0) {
      return `${props.failedTaskCount} failed ${props.failedTaskCount === 1 ? 'task' : 'tasks'}`;
    }
    if (isCompleted.value) return 'No failed tasks';
    if (isTerminalRunStatus(props.labRun.Status)) return props.labRun.Status;
    return 'In progress';
  });

  const sampleCount = computed(() => props.labRun.RunInputProfile?.SampleCount);
  const sampleSubtext = computed(() => {
    const sheet = props.labRun.SampleSheetS3Url?.split('/').pop();
    return sheet || null;
  });

  const runtime = computed(() => formatRunDuration(props.labRun.RunDurationSeconds));

  function formatTimeRangePart(input: string | null | undefined): string | null {
    if (!input) return null;
    const date = parseISO(input);
    if (!isValid(date)) return null;
    return format(date, 'h:mm aaa');
  }

  function formatDayPart(input: string | null | undefined): string | null {
    if (!input) return null;
    const date = parseISO(input);
    if (!isValid(date)) return null;
    return format(date, 'd MMM');
  }

  const runtimeSubtext = computed(() => {
    const start = formatTimeRangePart(props.labRun.CreatedAt);
    const end = formatTimeRangePart(props.labRun.TerminalAt);
    const day = formatDayPart(props.labRun.TerminalAt ?? props.labRun.CreatedAt);
    if (start && end && day) return `${start} to ${end}, ${day}`;
    if (start && day) return `from ${start}, ${day}`;
    return formatCompactDateTime(props.labRun.CreatedAt);
  });

  const costExplorerEnabled = useCostExplorerEnabled();
  const costSource = computed(() => resolveRunCostSource(props.labRun));
  const showCost = computed(() => showRunCostRow({ labRun: props.labRun }));

  function formatUsd(n: number | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return `US$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const costAmount = computed(() => {
    switch (costSource.value) {
      case 'billed':
        return `≈ ${formatUsd(props.labRun.BilledCost?.TotalUsd)}`;
      case 'outcome':
        return `≈ ${formatUsd(props.labRun.RunCostOutcome?.ActualComputeCostUsd)}`;
      case 'preRun': {
        const band = props.labRun.PreRunCostEstimate;
        return band ? `${formatUsd(band.LowUsd)} – ${formatUsd(band.HighUsd)}` : '—';
      }
      default:
        return '—';
    }
  });

  const costLabel = computed(() => {
    if (costSource.value === 'billed' || costSource.value === 'outcome') return 'Cost';
    return 'Estimated cost';
  });

  const costSubtext = computed(() => {
    if (costSource.value === 'billed') return 'Billed';
    if (isTerminalRunStatus(props.labRun.Status) && costSource.value !== 'billed') {
      return costExplorerEnabled.value ? 'Not billed yet' : 'Not billed';
    }
    return 'Estimate';
  });
</script>

<template>
  <section
    class="stroke-light grid grid-cols-2 gap-4 rounded-2xl border border-solid bg-white p-5 sm:grid-cols-4 sm:gap-0"
    aria-label="Run summary"
  >
    <div class="sm:border-stroke-light sm:border-r sm:pr-5">
      <p class="text-muted text-xs font-medium uppercase tracking-wide">Status</p>
      <div class="mt-2 flex items-center gap-2">
        <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :class="statusDotClass" aria-hidden="true" />
        <p class="text-lg font-semibold text-black">{{ statusLabel }}</p>
      </div>
      <p class="text-muted mt-1 text-sm">{{ statusSubtext }}</p>
    </div>

    <div class="sm:border-stroke-light sm:border-r sm:px-5">
      <p class="text-muted text-xs font-medium uppercase tracking-wide">Samples</p>
      <p class="mt-2 text-lg font-semibold text-black">
        {{ sampleCount != null ? sampleCount.toLocaleString() : '—' }}
      </p>
      <p v-if="sampleSubtext" class="text-muted mt-1 truncate text-sm" :title="sampleSubtext">{{ sampleSubtext }}</p>
      <p v-else class="text-muted mt-1 text-sm">From sample sheet</p>
    </div>

    <div class="sm:border-stroke-light sm:border-r sm:px-5">
      <p class="text-muted text-xs font-medium uppercase tracking-wide">Runtime</p>
      <p class="mt-2 text-lg font-semibold text-black">{{ runtime || '—' }}</p>
      <p v-if="runtimeSubtext" class="text-muted mt-1 text-sm">{{ runtimeSubtext }}</p>
    </div>

    <div class="sm:pl-5">
      <p class="text-muted flex items-center gap-1 text-xs font-medium uppercase tracking-wide">
        {{ costLabel }}
        <UTooltip
          v-if="showCost"
          :popper="{ placement: 'bottom' }"
          :ui="{ base: 'h-auto w-auto max-w-xs whitespace-normal text-left' }"
        >
          <button
            type="button"
            class="hover:border-primary-500 hover:text-primary-600 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[11px] italic text-gray-500"
            aria-label="Cost details"
          >
            i
          </button>
          <template #text>
            <p class="py-1 text-xs text-gray-600">
              Billed AWS cost when available; otherwise platform compute estimate or pre-run band. Not an invoice.
            </p>
          </template>
        </UTooltip>
      </p>
      <p class="mt-2 text-lg font-semibold text-black">{{ showCost ? costAmount : '—' }}</p>
      <p class="text-muted mt-1 text-sm">{{ showCost ? costSubtext : 'Unavailable' }}</p>
    </div>
  </section>
</template>
