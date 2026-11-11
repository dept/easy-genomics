<script setup lang="ts">
  import type { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
  import type { RunCostsLabRow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
  import { saveAs } from 'file-saver';
  import {
    formatChange,
    formatShare,
    formatUsd,
    periodLabel,
    recentMonths,
    runCostsCsv,
    runCostsCsvFileName,
    totalsChangePercent,
  } from '@FE/utils/run-costs';

  type PeriodMode = 'month' | '30d' | '60d' | '90d';

  const props = defineProps<{
    orgId: string;
    orgName: string;
  }>();

  const PERIOD_MODES: { value: PeriodMode; label: string }[] = [
    { value: 'month', label: 'Monthly' },
    { value: '30d', label: '30 days' },
    { value: '60d', label: '60 days' },
    { value: '90d', label: '90 days' },
  ];

  const runCostsStore = useRunCostsStore();
  const monthOptions = recentMonths(new Date());

  // Reopening the tab keeps the period the admin last looked at for this organization.
  const previousQuery = runCostsStore.query?.organizationId === props.orgId ? runCostsStore.query : null;
  const periodMode = ref<PeriodMode>(previousQuery?.period ?? 'month');
  const selectedMonth = ref(previousQuery?.period === 'month' ? previousQuery.month : monthOptions[0].value);

  const query = computed<RunCostsQuery>(() =>
    periodMode.value === 'month'
      ? { organizationId: props.orgId, period: 'month', month: selectedMonth.value }
      : { organizationId: props.orgId, period: periodMode.value },
  );

  watch(query, (nextQuery) => runCostsStore.load(nextQuery), { immediate: true });

  const report = computed(() => (runCostsStore.query?.organizationId === props.orgId ? runCostsStore.report : null));
  const shownPeriodLabel = computed(() => (runCostsStore.query ? periodLabel(runCostsStore.query) : ''));
  const labs = computed(() => report.value?.Labs ?? []);

  const cards = computed(() => {
    if (!report.value) return [];
    const { Totals, PreviousTotals } = report.value;
    return [
      {
        key: 'cost',
        label: 'Estimated cost',
        value: formatUsd(Totals.EstimatedCostUsd),
        detail: `Previous: ${formatUsd(PreviousTotals.EstimatedCostUsd)} (${formatChange(totalsChangePercent(report.value))})`,
      },
      { key: 'runs', label: 'Finished runs', value: Totals.FinishedRuns.toLocaleString() },
      { key: 'warned', label: 'Warned (launched anyway)', value: Totals.WarnedRuns.toLocaleString() },
      { key: 'blocked', label: 'Blocked', value: Totals.BlockedLaunches.toLocaleString() },
    ];
  });

  const expandedLabIds = ref(new Set<string>());

  function isExpanded(labId: string): boolean {
    return expandedLabIds.value.has(labId);
  }

  function toggleLab(labId: string) {
    const next = new Set(expandedLabIds.value);
    if (next.has(labId)) {
      next.delete(labId);
    } else {
      next.add(labId);
    }
    expandedLabIds.value = next;
  }

  function workflowRowIds(lab: RunCostsLabRow): string[] {
    return lab.Workflows.map((_, index) => `run-costs-${lab.LaboratoryId}-workflow-${index}`);
  }

  function expandAll() {
    expandedLabIds.value = new Set(labs.value.map((lab) => lab.LaboratoryId));
  }

  function collapseAll() {
    expandedLabIds.value = new Set();
  }

  function exportCsv() {
    if (!report.value) return;
    const blob = new Blob([runCostsCsv(report.value)], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, runCostsCsvFileName(props.orgName, shownPeriodLabel.value));
  }
</script>

<template>
  <div :aria-busy="runCostsStore.loading" class="flex flex-col gap-6">
    <p data-testid="run-costs-note" class="text-muted text-sm">
      Estimated from AWS list prices, for finished runs. Not your AWS bill.
    </p>

    <div class="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Period" class="flex gap-1 rounded-lg border border-neutral-200 p-1">
        <UButton
          v-for="mode in PERIOD_MODES"
          :key="mode.value"
          size="xs"
          :variant="periodMode === mode.value ? 'solid' : 'ghost'"
          :aria-pressed="periodMode === mode.value"
          @click="periodMode = mode.value"
        >
          {{ mode.label }}
        </UButton>
      </div>
      <USelect
        v-if="periodMode === 'month'"
        v-model="selectedMonth"
        :options="monthOptions"
        option-attribute="label"
        value-attribute="value"
        aria-label="Month"
        size="sm"
      />
    </div>

    <div v-if="!report && runCostsStore.loading" class="flex flex-col gap-4" data-testid="run-costs-loading">
      <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <USkeleton v-for="n in 4" :key="n" class="h-24 w-full rounded-2xl" />
      </div>
      <USkeleton class="h-48 w-full" />
    </div>

    <template v-else-if="report">
      <dl class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <div
          v-for="card in cards"
          :key="card.key"
          class="min-w-0 rounded-2xl border border-neutral-100 bg-white p-4 sm:p-6"
        >
          <dt class="text-muted text-xs leading-snug sm:text-sm">{{ card.label }}</dt>
          <dd class="text-heading m-0 break-words font-serif text-2xl font-semibold sm:text-3xl">{{ card.value }}</dd>
          <dd v-if="card.detail" class="text-muted m-0 mt-1 text-xs">{{ card.detail }}</dd>
        </div>
      </dl>

      <section class="border-background-dark-grey rounded-xl border bg-white p-6" aria-labelledby="run-costs-by-lab">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <EGText id="run-costs-by-lab" tag="h3" class="mr-auto">Costs by lab · {{ shownPeriodLabel }}</EGText>
          <UButton size="xs" variant="ghost" :disabled="labs.length === 0" @click="expandAll">Expand all</UButton>
          <UButton size="xs" variant="ghost" :disabled="labs.length === 0" @click="collapseAll">Collapse all</UButton>
          <UButton
            size="xs"
            icon="i-heroicons-arrow-down-tray"
            :disabled="runCostsStore.loading || labs.length === 0"
            @click="exportCsv"
          >
            Export CSV
          </UButton>
        </div>

        <p v-if="labs.length === 0" class="text-muted py-6 text-sm" role="status">No finished runs in this period.</p>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-muted text-xs">
              <tr>
                <th scope="col" class="px-3 py-2 font-semibold">Lab / Workflow</th>
                <th scope="col" class="px-3 py-2 text-right font-semibold">Runs</th>
                <th scope="col" class="px-3 py-2 text-right font-semibold">Estimated cost</th>
                <th scope="col" class="px-3 py-2 text-right font-semibold">Change</th>
                <th scope="col" class="px-3 py-2 font-semibold">Share</th>
              </tr>
            </thead>
            <tbody v-for="lab in labs" :key="lab.LaboratoryId" class="border-background-dark-grey border-t">
              <tr>
                <th scope="row" class="px-3 py-3 font-medium">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-left font-medium"
                    :aria-expanded="isExpanded(lab.LaboratoryId)"
                    :aria-controls="workflowRowIds(lab).join(' ')"
                    @click="toggleLab(lab.LaboratoryId)"
                  >
                    <UIcon
                      :name="isExpanded(lab.LaboratoryId) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
                      class="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {{ lab.LaboratoryName }}
                  </button>
                </th>
                <td class="px-3 py-3 text-right tabular-nums">{{ lab.FinishedRuns.toLocaleString() }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ formatUsd(lab.EstimatedCostUsd) }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ formatChange(lab.ChangePercent) }}</td>
                <td class="px-3 py-3">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded-full bg-neutral-100" aria-hidden="true">
                      <div class="bg-primary h-2 rounded-full" :style="{ width: `${lab.SharePercent}%` }" />
                    </div>
                    <span class="tabular-nums">{{ formatShare(lab.SharePercent) }}</span>
                  </div>
                </td>
              </tr>
              <tr
                v-for="(workflow, index) in isExpanded(lab.LaboratoryId) ? lab.Workflows : []"
                :id="workflowRowIds(lab)[index]"
                :key="`${workflow.Platform}#${workflow.WorkflowExternalId}`"
                data-testid="run-costs-workflow-row"
                class="text-muted"
              >
                <th scope="row" class="py-2 pl-10 pr-3 font-normal">
                  <span class="inline-flex items-center gap-2">
                    {{ workflow.WorkflowName }}
                    <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{{ workflow.Platform }}</span>
                  </span>
                </th>
                <td class="px-3 py-2 text-right tabular-nums">{{ workflow.FinishedRuns.toLocaleString() }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ formatUsd(workflow.EstimatedCostUsd) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ formatChange(workflow.ChangePercent) }}</td>
                <td class="px-3 py-2">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded-full bg-neutral-100" aria-hidden="true">
                      <div class="bg-primary-300 h-2 rounded-full" :style="{ width: `${workflow.SharePercent}%` }" />
                    </div>
                    <span class="tabular-nums">{{ formatShare(workflow.SharePercent) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
