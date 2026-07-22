<script setup lang="ts">
  import type { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

  const props = withDefaults(
    defineProps<{
      /** Pre-run estimate from estimate-run-cost API */
      estimate?: EstimateRunCostResponse | null;
      /** Post-run laboratory run record (for billed / platform outcome) */
      labRun?: LaboratoryRun | null;
      /** Loading state while fetching pre-run estimate */
      loading?: boolean;
      labelClass?: string;
      valueClass?: string;
    }>(),
    {
      estimate: null,
      labRun: null,
      loading: false,
      labelClass: 'w-48 text-black',
      valueClass: 'text-muted text-left',
    },
  );

  const costExplorerEnabled = computed(
    () => (useRuntimeConfig().public as { COST_EXPLORER_ENABLED?: boolean }).COST_EXPLORER_ENABLED === true,
  );

  const isPostRun = computed(() => !!props.labRun);
  const billed = computed(() => props.labRun?.BilledCost);
  const outcome = computed(() => props.labRun?.RunCostOutcome);
  const preRun = computed(() => props.labRun?.PreRunCostEstimate ?? null);

  /** True when post-run but no billed / platform / pre-run figure is available yet. */
  const isBilledPending = computed(
    () => isPostRun.value && !billed.value && outcome.value?.ActualComputeCostUsd == null && !preRun.value,
  );

  const rowLabel = computed(() => {
    if (!isPostRun.value) return 'Estimated cost';
    if (billed.value) return 'Billed cost';
    return 'Estimated cost';
  });

  const chipLabel = computed(() => {
    if (billed.value) return 'BILLED';
    return 'ESTIMATE';
  });

  const chipClass = computed(() => (billed.value ? 'bg-green-100 text-green-800' : 'bg-primary-100 text-primary-700'));

  function formatUsd(n: number | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return `US$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const amountText = computed(() => {
    if (props.loading) return 'Calculating estimate…';
    if (isPostRun.value) {
      if (billed.value) return `≈ ${formatUsd(billed.value.TotalUsd)}`;
      if (outcome.value?.ActualComputeCostUsd != null) {
        return `≈ ${formatUsd(outcome.value.ActualComputeCostUsd)}`;
      }
      if (preRun.value) {
        return `${formatUsd(preRun.value.LowUsd)} – ${formatUsd(preRun.value.HighUsd)}`;
      }
      return costExplorerEnabled.value ? 'Billed cost pending' : 'Billed cost unavailable';
    }
    if (!props.estimate) return '—';
    if (!props.estimate.estimateAvailable || !props.estimate.computeCostUsd) {
      return 'Cost estimate unavailable';
    }
    const { low, high } = props.estimate.computeCostUsd;
    return `${formatUsd(low)} – ${formatUsd(high)}`;
  });

  const tooltipTitle = computed(() => {
    if (billed.value) return 'Billed cost from AWS Cost Explorer';
    if (isBilledPending.value) {
      return costExplorerEnabled.value ? 'Billed cost pending' : 'Billed cost unavailable';
    }
    return 'Estimated, not billed.';
  });

  const tooltipBody = computed(() => {
    if (billed.value) {
      return 'Grouped by run tags. Pre-run estimate and platform compute estimate shown for comparison. Data may lag 24–48 hours.';
    }
    if (isBilledPending.value) {
      return costExplorerEnabled.value
        ? 'AWS Cost Explorer billed cost typically appears within 24–48 hours after the run completes. Check back later.'
        : 'Billed per-run AWS cost requires Cost Explorer (and cost allocation tags) to be enabled for this deployment. Platform and historical estimates are still available when there is run history.';
    }
    if (isPostRun.value && outcome.value) {
      return outcome.value.CostSource === 'SEQERA_PROGRESS'
        ? 'Seqera Tower compute estimate. Excludes storage, network, and head-job costs.'
        : 'Based on HealthOmics task instance usage. Excludes S3 and data transfer.';
    }
    return (
      props.estimate?.disclaimer ||
      'Estimated compute cost based on similar completed runs of this workflow. This is not an invoice. S3, data transfer, and run storage are not included.'
    );
  });

  const breakdownLines = computed<{ label: string; value: string }[]>(() => {
    const lines: { label: string; value: string }[] = [];
    if (billed.value?.ByService) {
      for (const [svc, amt] of Object.entries(billed.value.ByService)) {
        lines.push({ label: svc, value: `≈ ${formatUsd(amt)}` });
      }
    } else if (outcome.value?.ActualComputeCostUsd != null) {
      lines.push({
        label: outcome.value.CostSource === 'SEQERA_PROGRESS' ? 'Compute (Seqera)' : 'Compute (HealthOmics)',
        value: `≈ ${formatUsd(outcome.value.ActualComputeCostUsd)}`,
      });
      if (outcome.value.ActualStorageCostUsd != null) {
        lines.push({
          label: 'Run storage (HealthOmics)',
          value: `≈ ${formatUsd(outcome.value.ActualStorageCostUsd)}`,
        });
      }
    } else if (props.estimate?.computeCostUsd) {
      lines.push({
        label: 'Estimated compute',
        value: `${formatUsd(props.estimate.computeCostUsd.low)} – ${formatUsd(props.estimate.computeCostUsd.high)}`,
      });
    } else if (preRun.value) {
      lines.push({
        label: 'Pre-run estimate',
        value: `${formatUsd(preRun.value.LowUsd)} – ${formatUsd(preRun.value.HighUsd)}`,
      });
    }
    return lines;
  });

  const footerText = computed(() => {
    if (billed.value?.AsOfDate) {
      return `Data as of ${billed.value.AsOfDate}. AWS billing data typically updates within 24–48 hours.`;
    }
    if (isBilledPending.value) {
      return costExplorerEnabled.value
        ? 'Billed amounts are synced daily from Cost Explorer once available.'
        : 'Enable Cost Explorer for this deployment to sync billed AWS charges.';
    }
    if (isPostRun.value && !billed.value && !costExplorerEnabled.value) {
      return 'Billed AWS charges are not synced until Cost Explorer is enabled for this deployment.';
    }
    return 'Actual AWS charges may vary with runtime and retries.';
  });
</script>

<template>
  <div class="cost-row text-md flex items-center rounded-lg border-b px-4 py-4 last:border-0">
    <dt :class="labelClass">{{ rowLabel }}</dt>
    <dd :class="valueClass">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base font-semibold text-gray-900">{{ amountText }}</span>
        <span
          v-if="!loading && (estimate?.estimateAvailable || labRun)"
          class="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide"
          :class="chipClass"
        >
          {{ chipLabel }}
        </span>
        <!-- Nuxt UI tooltip defaults to h-6 + truncate on a white bg; override so multi-line copy is visible. -->
        <UTooltip
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
            <div class="space-y-2 py-1 text-xs leading-relaxed">
              <p class="font-semibold text-gray-900">{{ tooltipTitle }}</p>
              <p class="text-gray-600">{{ tooltipBody }}</p>
              <div v-if="breakdownLines.length" class="space-y-1 border-t border-gray-200 pt-2">
                <div v-for="line in breakdownLines" :key="line.label" class="flex justify-between gap-4 text-gray-600">
                  <span>{{ line.label }}</span>
                  <span>{{ line.value }}</span>
                </div>
              </div>
              <p class="text-[11px] text-gray-500">{{ footerText }}</p>
            </div>
          </template>
        </UTooltip>
      </div>
    </dd>
  </div>
</template>

<style scoped>
  .cost-row {
    background: linear-gradient(90deg, #faf9ff, #fff);
  }
</style>
