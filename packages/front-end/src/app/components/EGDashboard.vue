<script setup lang="ts">
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
  import { Pipeline as SeqeraPipeline } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { WorkflowListItem as OmicsWorkflow } from '@aws-sdk/client-omics';
  import { useUiStore, useSeqeraPipelinesStore, useOmicsWorkflowsStore } from '@FE/stores';
  import { isLaboratoryRunOwnedByUser } from '@FE/utils/laboratory-run-ownership';
  import { TableSort } from './EGTable.vue';

  const props = defineProps<{
    labId: string;
  }>();

  const { $api } = useNuxtApp();
  const $router = useRouter();
  const $route = useRoute();
  const labStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  useInitialPendingRequests('loadDashboardData');
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();

  const lab = computed<Laboratory | null>(() => labStore.labs[props.labId] ?? null);
  const labName = computed<string>(() => lab.value?.Name || '');

  const allRuns = ref<LaboratoryRun[]>([]);
  const favouriteWorkflows = ref<FavouriteWorkflow[]>([]);
  const searchQuery = ref('');
  const searchFocused = ref(false);
  const overviewTimeFilter = ref<'7' | '30' | '90'>('30');
  const searchInputId = 'dashboard-global-search';
  const searchResultsListId = 'dashboard-global-search-results';
  const overviewTimeFilterId = 'dashboard-overview-time-filter';
  const overviewHeadingId = 'dashboard-overview-heading';
  const recentRunsHeadingId = 'dashboard-recent-runs-heading';
  const favouriteWorkflowsHeadingId = 'dashboard-favourite-workflows-heading';
  const inProgressHeadingId = 'dashboard-in-progress-heading';
  const recentRunsMyRunsOnlyId = 'dashboard-recent-runs-my-runs-only';
  const highlightedSearchIndex = ref(-1);
  const recentRunsMyRunsOnly = ref(false);

  const IN_PROGRESS_STATUSES = new Set(['SUBMITTED', 'STARTING', 'RUNNING']);

  interface SearchResult {
    type: 'run' | 'seqera-pipeline' | 'omics-workflow';
    id: string;
    name: string;
    subtitle?: string;
    status?: string;
  }

  const seqeraPipelines = computed<SeqeraPipeline[]>(() => seqeraPipelinesStore.pipelinesForLab(props.labId));
  const omicsWorkflows = computed<OmicsWorkflow[]>(() => omicsWorkflowsStore.workflowsForLab(props.labId));

  const searchResults = computed<SearchResult[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];

    for (const run of allRuns.value) {
      const haystack = [run.RunName, run.Description, run.WorkflowName, run.Owner, run.Status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          type: 'run',
          id: run.RunId,
          name: run.RunName,
          subtitle: run.WorkflowName,
          status: run.Status,
        });
      }
    }

    for (const pipeline of seqeraPipelines.value) {
      const haystack = [pipeline.name, pipeline.description].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          type: 'seqera-pipeline',
          id: String(pipeline.pipelineId ?? ''),
          name: pipeline.name ?? '',
          subtitle: pipeline.description ?? undefined,
        });
      }
    }

    for (const workflow of omicsWorkflows.value) {
      const haystack = [workflow.name, workflow.description].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          type: 'omics-workflow',
          id: workflow.id ?? '',
          name: workflow.name ?? '',
          subtitle: workflow.description ?? undefined,
        });
      }
    }

    return results.slice(0, 10);
  });

  const showDropdown = computed(() => searchFocused.value && searchQuery.value.trim().length > 0);

  const searchStatusMessage = computed(() => {
    const q = searchQuery.value.trim();
    if (!q || !searchFocused.value) return '';
    if (searchResults.value.length === 0) return `No results for "${q}"`;
    const noun = searchResults.value.length === 1 ? 'result' : 'results';
    return `${searchResults.value.length} search ${noun} for "${q}"`;
  });

  watch([searchQuery, searchResults], () => {
    highlightedSearchIndex.value = searchResults.value.length > 0 ? 0 : -1;
  });

  function searchOptionId(index: number): string {
    return `${searchResultsListId}-option-${index}`;
  }

  function selectSearchResult(result: SearchResult) {
    searchFocused.value = false;
    searchQuery.value = '';

    switch (result.type) {
      case 'run':
        $router.push({ path: `/labs/${props.labId}/run/${result.id}`, query: { tab: 'Run Details' } });
        break;
      case 'seqera-pipeline':
        $router.push({
          path: `/labs/${props.labId}/run-pipeline/${result.id}`,
          query: { seqeraRunTempId: crypto.randomUUID() },
        });
        break;
      case 'omics-workflow':
        $router.push({
          path: `/labs/${props.labId}/run-workflow/${result.id}`,
          query: { omicsRunTempId: crypto.randomUUID() },
        });
        break;
    }
  }

  function resultTypeLabel(type: SearchResult['type']): string {
    switch (type) {
      case 'run':
        return 'Run';
      case 'seqera-pipeline':
        return 'Seqera Pipeline';
      case 'omics-workflow':
        return 'HealthOmics Workflow';
    }
  }

  function onSearchBlur() {
    setTimeout(() => {
      searchFocused.value = false;
      highlightedSearchIndex.value = -1;
    }, 200);
  }

  function onSearchKeydown(event: KeyboardEvent) {
    const results = searchResults.value;
    const hasResults = results.length > 0;

    if (!showDropdown.value) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && hasResults) {
        event.preventDefault();
        searchFocused.value = true;
        highlightedSearchIndex.value = event.key === 'ArrowDown' ? 0 : results.length - 1;
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (hasResults) {
          highlightedSearchIndex.value = Math.min(highlightedSearchIndex.value + 1, results.length - 1);
          scrollHighlightedOptionIntoView();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (hasResults) {
          highlightedSearchIndex.value = Math.max(highlightedSearchIndex.value - 1, 0);
          scrollHighlightedOptionIntoView();
        }
        break;
      case 'Home':
        event.preventDefault();
        if (hasResults) highlightedSearchIndex.value = 0;
        break;
      case 'End':
        event.preventDefault();
        if (hasResults) highlightedSearchIndex.value = results.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightedSearchIndex.value >= 0 && highlightedSearchIndex.value < results.length) {
          selectSearchResult(results[highlightedSearchIndex.value]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        searchFocused.value = false;
        highlightedSearchIndex.value = -1;
        break;
    }
  }

  function scrollHighlightedOptionIntoView() {
    nextTick(() => {
      const option = document.getElementById(searchOptionId(highlightedSearchIndex.value));
      option?.scrollIntoView({ block: 'nearest' });
    });
  }

  const timeFilterOptions = [
    { label: 'Past 7 days', value: '7' },
    { label: 'Past 30 days', value: '30' },
    { label: 'Past 90 days', value: '90' },
  ];

  const overviewTimeFilterLabel = computed(() => {
    const selected = timeFilterOptions.find((opt) => opt.value === overviewTimeFilter.value);
    return selected?.label ?? 'Past 30 days';
  });

  /**
   * Returns the timestamp used to anchor a run inside the dashboard's time window.
   * Prefer the platform-reported completion time when present, then the creation time.
   * Avoid `ModifiedAt` because backend jobs (retention updates, tag backfills, status
   * checks) touch it long after execution, which would otherwise pull historical runs
   * into the "past 7/30/90 days" window and skew metrics.
   */
  function getAnchorTime(run: LaboratoryRun): number {
    const iso = run.RunCompletedAt ?? run.CreatedAt;
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const filteredRunsForOverview = computed(() => {
    const now = Date.now();
    const days = parseInt(overviewTimeFilter.value);
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return allRuns.value.filter((run) => getAnchorTime(run) >= cutoff);
  });

  const activeRuns = computed(() => filteredRunsForOverview.value.filter((r) => IN_PROGRESS_STATUSES.has(r.Status)));

  /** All currently active runs in the lab (not limited by the overview time filter). */
  const inProgressRuns = computed(() =>
    [...allRuns.value]
      .filter((r) => IN_PROGRESS_STATUSES.has(r.Status))
      .sort((a, b) => {
        const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
        const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
        return dateB - dateA;
      }),
  );

  const completedRuns = computed(() =>
    filteredRunsForOverview.value.filter((r) => ['COMPLETED', 'SUCCEEDED'].includes(r.Status)),
  );

  const failedRuns = computed(() => filteredRunsForOverview.value.filter((r) => r.Status === 'FAILED'));

  const avgRunTime = computed(() => {
    // Dashboard reads the platform-reported execution duration directly from the record
    // (populated server-side from Seqera `workflow.duration` or AWS HealthOmics
    // `stopTime - startTime`). Runs without this value are excluded rather than falling
    // back to CreatedAt/ModifiedAt, which are distorted by background updates (tagging,
    // retention policy recompute, etc.).
    const runsWithDuration = filteredRunsForOverview.value.filter(
      (r) =>
        typeof r.RunDurationSeconds === 'number' &&
        Number.isFinite(r.RunDurationSeconds) &&
        r.RunDurationSeconds >= 0 &&
        ['COMPLETED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.Status),
    );
    if (runsWithDuration.length === 0) return '—';

    const totalSeconds = runsWithDuration.reduce((sum, r) => sum + (r.RunDurationSeconds ?? 0), 0);
    const avgSeconds = totalSeconds / runsWithDuration.length;
    const hours = avgSeconds / 3600;
    if (hours < 1) {
      const mins = Math.round(avgSeconds / 60);
      return `${mins}m`;
    }
    return `${hours.toFixed(1)}h`;
  });

  const costExplorerEnabled = useCostExplorerEnabled();

  function runSpendUsd(r: {
    BilledCost?: { TotalUsd?: number };
    RunCostOutcome?: { ActualComputeCostUsd?: number };
  }): number | undefined {
    const billed = r.BilledCost?.TotalUsd;
    if (typeof billed === 'number' && Number.isFinite(billed)) return billed;
    const estimate = r.RunCostOutcome?.ActualComputeCostUsd;
    if (typeof estimate === 'number' && Number.isFinite(estimate)) return estimate;
    return undefined;
  }

  /** True unless every run that contributes a figure has BilledCost. */
  const runSpendIsEstimateOnly = computed(() => {
    const withAmount = filteredRunsForOverview.value.filter((r) => runSpendUsd(r) != null);
    if (withAmount.length === 0) return true;
    return !withAmount.every(
      (r) => typeof r.BilledCost?.TotalUsd === 'number' && Number.isFinite(r.BilledCost.TotalUsd),
    );
  });

  /** Per-run BilledCost ?? RunCostOutcome, so mixed CE sync windows do not under-count. */
  const totalBilledSpend = computed(() => {
    const amounts = filteredRunsForOverview.value.map(runSpendUsd).filter((n): n is number => n != null);
    if (amounts.length === 0) return '—';
    const sum = amounts.reduce((s, n) => s + n, 0);
    return runSpendIsEstimateOnly.value ? `≈ US$${sum.toFixed(2)}` : `US$${sum.toFixed(2)}`;
  });

  const recentRuns = computed(() => {
    // Match the design: in-progress runs live in the In progress section, not Recent runs.
    const currentUser = {
      id: userStore.currentUserDetails.id,
      email: userStore.currentUserDetails.email,
    };

    return [...allRuns.value]
      .filter((r) => !IN_PROGRESS_STATUSES.has(r.Status))
      .filter((r) => !recentRunsMyRunsOnly.value || isLaboratoryRunOwnedByUser(r, currentUser))
      .sort((a, b) => {
        const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
        const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 5);
  });

  function viewAllRuns() {
    $router.push({
      path: `/labs/${props.labId}`,
      query: { ...$route.query, tab: 'Pipeline Runs' },
    });
  }

  const recentRunsTableColumns = [
    { key: 'RunName', label: 'Run Name', sortable: true },
    { key: 'WorkflowName', label: 'Workflow', sortable: true },
    { key: 'CreatedAt', label: 'Created', sortable: true },
    { key: 'lastUpdated', label: 'Last Updated', sortable: true },
    { key: 'Status', label: 'Status', sortable: true },
    { key: 'actions', label: 'Actions' },
  ];

  const recentRunsSort = ref<TableSort>({ column: 'lastUpdated', direction: 'desc' });

  function toSortableString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).toLowerCase();
  }

  function toSortableTime(value: unknown): number {
    if (!value) return 0;
    const t = new Date(String(value)).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const recentRunsTableItems = computed(() => {
    const items = recentRuns.value.map((run) => ({
      ...run,
      lastUpdated: run.ModifiedAt ?? run.CreatedAt ?? '',
    }));

    const { column, direction } = recentRunsSort.value ?? { column: 'lastUpdated', direction: 'desc' as const };
    const dir = direction === 'asc' ? 1 : -1;

    return [...items].sort((a, b) => {
      if (column === 'lastUpdated') return (toSortableTime(a.lastUpdated) - toSortableTime(b.lastUpdated)) * dir;
      if (column === 'CreatedAt') return (toSortableTime(a.CreatedAt) - toSortableTime(b.CreatedAt)) * dir;
      if (column === 'RunName') return toSortableString(a.RunName).localeCompare(toSortableString(b.RunName)) * dir;
      if (column === 'WorkflowName')
        return toSortableString(a.WorkflowName).localeCompare(toSortableString(b.WorkflowName)) * dir;
      if (column === 'Status') return toSortableString(a.Status).localeCompare(toSortableString(b.Status)) * dir;

      const av = (a as any)?.[column];
      const bv = (b as any)?.[column];
      return toSortableString(av).localeCompare(toSortableString(bv)) * dir;
    });
  });

  const favouriteWorkflowsTableColumns = [
    { key: 'WorkflowName', label: 'Name' },
    { key: 'Description', label: 'Description' },
    { key: 'run', label: 'Run' },
  ];

  const displayedFavouriteWorkflows = computed(() => favouriteWorkflows.value.slice(0, 5));

  function viewRunDetails(run: LaboratoryRun) {
    $router.push({
      path: `/labs/${props.labId}/run/${run.RunId}`,
      query: { tab: 'Run Details' },
    });
  }

  function runsActionItems(run: LaboratoryRun): object[] {
    return [
      [{ label: 'View Details', click: () => viewRunDetails(run) }],
      [
        {
          label: 'View Files',
          click: () => $router.push({ path: `/labs/${props.labId}/run/${run.RunId}`, query: { tab: 'File Manager' } }),
        },
      ],
    ];
  }

  function runFavouriteWorkflow(workflow: FavouriteWorkflow) {
    const path =
      workflow.Platform === 'Seqera Cloud'
        ? `/labs/${props.labId}/run-pipeline/${workflow.WorkflowId}`
        : `/labs/${props.labId}/run-workflow/${workflow.WorkflowId}`;
    const queryKey = workflow.Platform === 'Seqera Cloud' ? 'seqeraRunTempId' : 'omicsRunTempId';
    $router.push({ path, query: { [queryKey]: crypto.randomUUID() } });
  }

  function navigateBack() {
    $router.push('/labs');
  }

  const TERMINAL_STATUSES = new Set(['FAILED', 'SUCCEEDED', 'CANCELLED', 'COMPLETED', 'DELETED']);

  function terminalRunsMissingDuration(runs: LaboratoryRun[]): LaboratoryRun[] {
    return runs.filter((r) => TERMINAL_STATUSES.has(r.Status) && r.RunDurationSeconds == null);
  }

  function runIdsNeedingRefresh(runs: LaboratoryRun[]): string[] {
    return runs.filter((r) => !TERMINAL_STATUSES.has(r.Status) || r.RunDurationSeconds == null).map((r) => r.RunId);
  }

  /**
   * Bounded polling to pick up the result of the async backfill that the SNS processor
   * runs after `requestLabRunStatusCheck`. The processor writes `RunDurationSeconds`
   * off-band, so we re-fetch the runs a few times until either every terminal run has
   * a duration or we hit the timeout. The poll is cancelled if the component unmounts
   * or another dashboard load starts.
   */
  const BACKFILL_POLL_INTERVAL_MS = 3000;
  const BACKFILL_POLL_TIMEOUT_MS = 30_000;
  let backfillPollTimer: ReturnType<typeof setTimeout> | null = null;
  let backfillPollToken = 0;

  function cancelBackfillPoll() {
    if (backfillPollTimer != null) {
      clearTimeout(backfillPollTimer);
      backfillPollTimer = null;
    }
    backfillPollToken++;
  }

  function schedulePendingRuntimePoll(pendingRunIds: Set<string>) {
    if (pendingRunIds.size === 0) return;

    cancelBackfillPoll();
    const token = ++backfillPollToken;
    const startedAt = Date.now();

    const tick = async () => {
      if (token !== backfillPollToken) return;

      try {
        const refreshed: LaboratoryRun[] = await $api.labs.listLabRuns(props.labId);
        if (token !== backfillPollToken) return;

        allRuns.value = refreshed;

        const stillPending = refreshed.some(
          (r) => pendingRunIds.has(r.RunId) && TERMINAL_STATUSES.has(r.Status) && r.RunDurationSeconds == null,
        );
        if (!stillPending) {
          cancelBackfillPoll();
          return;
        }
      } catch (error) {
        console.error('Runtime backfill poll failed', error);
      }

      if (Date.now() - startedAt >= BACKFILL_POLL_TIMEOUT_MS) {
        cancelBackfillPoll();
        return;
      }
      backfillPollTimer = setTimeout(tick, BACKFILL_POLL_INTERVAL_MS);
    };

    backfillPollTimer = setTimeout(tick, BACKFILL_POLL_INTERVAL_MS);
  }

  /**
   * Fire-and-forget request for the back-end to refresh runtime data. Covers both live
   * non-terminal runs (normal status refresh) and terminal runs missing
   * `RunDurationSeconds` (legacy-row backfill). After enqueueing the work, start a
   * bounded poll so the UI picks up the healed values without a manual reload.
   */
  async function requestRuntimeRefresh(runs: LaboratoryRun[]) {
    const runIds = runIdsNeedingRefresh(runs);
    if (runIds.length === 0) return;

    const pendingBackfillIds = new Set(terminalRunsMissingDuration(runs).map((r) => r.RunId));

    try {
      await $api.labs.requestLabRunStatusCheck(props.labId, runIds);
    } catch (error) {
      console.error('Failed to request dashboard runtime refresh', error);
      return;
    }

    schedulePendingRuntimePoll(pendingBackfillIds);
  }

  async function loadDashboardData() {
    cancelBackfillPoll();
    uiStore.setRequestPending('loadDashboardData');
    try {
      await labStore.loadLab(props.labId);

      const labData = labStore.labs[props.labId];
      const promises: Promise<any>[] = [$api.labs.listLabRuns(props.labId), $api.users.getUser()];

      if (labData?.NextFlowTowerEnabled) {
        promises.push(
          seqeraPipelinesStore
            .loadPipelinesForLab(props.labId)
            .catch(() => useToastStore().error('Failed to load pipelines. Please refresh.')),
        );
      }
      if (labData?.AwsHealthOmicsEnabled) {
        promises.push(
          omicsWorkflowsStore
            .loadWorkflowsForLab(props.labId)
            .catch(() => useToastStore().error('Failed to load workflows. Please refresh.')),
        );
      }

      const [runs, user] = await Promise.all(promises);

      allRuns.value = runs;
      favouriteWorkflows.value = (user.FavouriteWorkflows ?? []).filter(
        (w: FavouriteWorkflow) => w.LaboratoryId === props.labId,
      );

      void requestRuntimeRefresh(runs);
    } catch (error) {
      console.error('Error loading dashboard data', error);
    } finally {
      uiStore.setRequestComplete('loadDashboardData');
    }
  }

  onBeforeMount(loadDashboardData);
  onBeforeUnmount(cancelBackfillPoll);

  const overviewStats = computed(() => [
    {
      key: 'active-runs',
      icon: 'i-heroicons-beaker',
      value: activeRuns.value.length,
      label: 'Active Runs',
      bgColor: 'bg-primary-muted',
      iconColor: 'text-primary',
    },
    {
      key: 'completed-runs',
      icon: 'i-heroicons-check-circle',
      value: completedRuns.value.length,
      label: 'Completed Runs',
      bgColor: 'bg-alert-success-muted',
      iconColor: 'text-alert-success',
    },
    {
      key: 'failed-runs',
      icon: 'i-heroicons-x-circle',
      value: failedRuns.value.length,
      label: 'Failed Runs',
      bgColor: 'bg-alert-danger-muted',
      iconColor: 'text-alert-danger',
    },
    {
      key: 'avg-run-time',
      icon: 'i-heroicons-clock',
      value: avgRunTime.value,
      label: 'Avg Run time',
      bgColor: 'bg-background-light-grey',
      iconColor: 'text-muted',
    },
    {
      key: 'run-spend',
      icon: 'i-heroicons-currency-dollar',
      value: totalBilledSpend.value,
      label: !costExplorerEnabled.value || runSpendIsEstimateOnly.value ? 'Estimated run spend' : 'Run spend',
      bgColor: 'bg-primary-muted',
      iconColor: 'text-primary',
    },
  ]);
</script>

<template>
  <div class="dashboard" :aria-busy="uiStore.isRequestPending('loadDashboardData')">
    <!-- Header: Title + Search -->
    <div class="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <button
          type="button"
          class="text-primary focus-visible:outline-primary-500 mb-2 flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          @click="navigateBack"
        >
          <UIcon name="i-heroicons-arrow-left" class="h-4 w-4" aria-hidden="true" />
          Back to laboratories
        </button>
        <EGText tag="h1" size="md" class="mb-0">Laboratory of {{ labName }}</EGText>
      </div>
      <div class="relative w-full max-w-[320px] sm:shrink-0">
        <label :for="searchInputId" class="sr-only">Search runs, workflows, and results</label>
        <UInput
          :id="searchInputId"
          v-model="searchQuery"
          placeholder="Search Runs, Workflows, Results"
          icon="i-heroicons-magnifying-glass-20-solid"
          autocomplete="off"
          :trailing="true"
          role="combobox"
          :aria-expanded="showDropdown"
          :aria-controls="showDropdown ? searchResultsListId : undefined"
          :aria-activedescendant="
            showDropdown && highlightedSearchIndex >= 0 ? searchOptionId(highlightedSearchIndex) : undefined
          "
          aria-autocomplete="list"
          :ui="{
            placeholder: 'placeholder-text-muted',
            base: 'focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
            focus: 'outline-none border-0',
            icon: { base: 'text-neutral-black w-[24px] h-[24px]' },
            padding: { sm: 'px-5 py-4' },
            color: { white: { outline: 'shadow-none focus-visible:ring-2 focus-visible:ring-primary-500' } },
          }"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
          @keydown="onSearchKeydown"
        />

        <p class="sr-only" aria-live="polite" aria-atomic="true">{{ searchStatusMessage }}</p>

        <div
          v-if="showDropdown"
          class="absolute left-0 right-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-lg sm:left-auto sm:w-[420px]"
          role="presentation"
        >
          <div v-if="searchResults.length === 0" class="text-muted px-4 py-6 text-center text-sm" role="status">
            No results found
          </div>
          <ul
            v-else
            :id="searchResultsListId"
            class="max-h-[360px] overflow-y-auto"
            role="listbox"
            aria-label="Search results"
          >
            <li
              v-for="(result, index) in searchResults"
              :key="`${result.type}-${result.id}`"
              :id="searchOptionId(index)"
              role="option"
              :aria-selected="highlightedSearchIndex === index"
              class="border-b border-neutral-100 last:border-b-0"
              :class="{ 'bg-background-light-grey': highlightedSearchIndex === index }"
              @mousedown.prevent="selectSearchResult(result)"
            >
              <div class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left">
                <UIcon
                  :name="result.type === 'run' ? 'i-heroicons-clock' : 'i-heroicons-command-line'"
                  class="text-muted h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <div class="min-w-0 flex-1">
                  <div class="text-body truncate text-sm font-medium">{{ result.name }}</div>
                  <div v-if="result.subtitle" class="text-muted truncate text-xs">{{ result.subtitle }}</div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <EGStatusChip v-if="result.status" :status="result.status" />
                  <span class="text-muted whitespace-nowrap text-xs">{{ resultTypeLabel(result.type) }}</span>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- In progress -->
    <section v-if="inProgressRuns.length > 0" class="mt-8" :aria-labelledby="inProgressHeadingId">
      <EGText :id="inProgressHeadingId" tag="h2" size="sm" class="mb-3">In progress</EGText>
      <div class="flex flex-col gap-3">
        <EGInProgressRunCard v-for="run in inProgressRuns" :key="run.RunId" :run="run" :lab-id="labId" />
      </div>
    </section>

    <!-- Favorite Workflows -->
    <section class="mt-10" :aria-labelledby="favouriteWorkflowsHeadingId">
      <div class="mb-8">
        <EGText :id="favouriteWorkflowsHeadingId" tag="h2" size="sm" class="mb-0">Favorite Workflows</EGText>
        <p class="text-muted text-sm">Quick launch your most used workflows.</p>
      </div>

      <EGTable
        :table-data="displayedFavouriteWorkflows"
        :columns="favouriteWorkflowsTableColumns"
        :is-loading="uiStore.isRequestPending('loadDashboardData')"
        :show-pagination="false"
        :labelled-by="favouriteWorkflowsHeadingId"
      >
        <template #WorkflowName-data="{ row: workflow }">
          <div class="text-body text-sm font-semibold">{{ workflow.WorkflowName }}</div>
        </template>

        <template #Description-data="{ row: workflow }">
          <div class="text-muted text-sm">{{ workflow.Description || '—' }}</div>
        </template>

        <template #run-data="{ row: workflow }">
          <button
            type="button"
            class="text-primary hover:text-primary-dark hover:bg-primary-muted focus-visible:outline-primary-500 flex items-center justify-center rounded-full p-1 transition-all duration-150 hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            :aria-label="`Run workflow ${workflow.WorkflowName}`"
            @click.stop="runFavouriteWorkflow(workflow)"
          >
            <UIcon name="i-heroicons-play-circle" class="h-6 w-6" aria-hidden="true" />
          </button>
        </template>

        <template #empty-state>
          <div class="text-muted flex h-24 items-center justify-center font-normal">No favorite workflows yet</div>
        </template>
      </EGTable>
    </section>

    <!-- Recent Runs -->
    <section class="mt-10" :aria-labelledby="recentRunsHeadingId">
      <div class="mb-8 flex items-center justify-between gap-4">
        <EGText :id="recentRunsHeadingId" tag="h2" size="sm" class="mb-0">Recent Runs</EGText>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <UToggle
              :id="recentRunsMyRunsOnlyId"
              v-model="recentRunsMyRunsOnly"
              :aria-labelledby="`${recentRunsMyRunsOnlyId}-label`"
            />
            <label :id="`${recentRunsMyRunsOnlyId}-label`" :for="recentRunsMyRunsOnlyId" class="text-body text-sm">
              My runs only
            </label>
          </div>
          <button
            type="button"
            class="text-primary hover:text-primary-dark focus-visible:outline-primary-500 inline-flex items-center gap-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            @click="viewAllRuns"
          >
            View all
            <UIcon name="i-heroicons-arrow-right" class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <EGTable
        :row-click-action="viewRunDetails"
        :table-data="recentRunsTableItems"
        :columns="recentRunsTableColumns"
        v-model:sort="recentRunsSort"
        :is-loading="uiStore.isRequestPending('loadDashboardData')"
        :show-pagination="false"
        :labelled-by="recentRunsHeadingId"
      >
        <template #RunName-data="{ row: run }">
          <div v-if="run.RunName" class="text-body text-sm font-medium">{{ run.RunName }}</div>
          <div v-if="run.Owner" class="text-muted text-xs font-normal">{{ run.Owner }}</div>
          <div v-if="run.Description" class="text-muted line-clamp-1 text-xs font-normal">{{ run.Description }}</div>
        </template>

        <template #WorkflowName-data="{ row: run }">
          <div class="text-body text-sm font-medium">{{ run.WorkflowName || '—' }}</div>
        </template>

        <template #CreatedAt-data="{ row: run }">
          <div class="text-body text-sm font-medium">{{ getDate(run.CreatedAt) }}</div>
          <div class="text-muted text-xs">{{ getTime(run.CreatedAt) }}</div>
        </template>

        <template #lastUpdated-data="{ row: run }">
          <div class="text-body text-sm font-medium">{{ formatRelativeDateTime(run.lastUpdated) }}</div>
        </template>

        <template #Status-data="{ row: run }">
          <EGStatusChip :status="run.Status" />
        </template>

        <template #actions-data="{ row }">
          <div class="flex justify-end">
            <EGActionButton
              :items="runsActionItems(row)"
              :menu-label="`Actions for ${row.RunName || 'run'}`"
              class="ml-2"
              @click="$event.stopPropagation()"
            />
          </div>
        </template>

        <template #empty-state>
          <div class="text-muted flex h-24 items-center justify-center font-normal">
            {{ recentRunsMyRunsOnly ? 'No recent runs initiated by you' : 'No recent runs' }}
          </div>
        </template>
      </EGTable>
    </section>

    <!-- Lab metrics -->
    <section class="mt-10" :aria-labelledby="overviewHeadingId">
      <div class="flex items-center justify-between">
        <EGText :id="overviewHeadingId" tag="h2" size="sm" class="mb-0">Lab metrics</EGText>
        <div>
          <label :for="overviewTimeFilterId" class="sr-only">Overview time period</label>
          <select
            :id="overviewTimeFilterId"
            v-model="overviewTimeFilter"
            class="text-body focus-visible:outline-primary-500 rounded-lg border border-neutral-100 bg-white px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            :aria-label="`Overview time period, ${overviewTimeFilterLabel}`"
          >
            <option v-for="opt in timeFilterOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <div
          v-for="stat in overviewStats"
          :key="stat.key"
          class="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 sm:gap-4 sm:p-6"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12"
            :class="stat.bgColor"
            aria-hidden="true"
          >
            <UIcon :name="stat.icon" class="h-5 w-5 sm:h-6 sm:w-6" :class="stat.iconColor" />
          </div>
          <div class="min-w-0">
            <dt class="text-muted leading-snug" :class="stat.key === 'run-spend' ? 'text-xs' : 'text-xs sm:text-sm'">
              {{ stat.label }}
            </dt>
            <dd
              class="text-heading m-0 break-words font-serif font-semibold"
              :class="stat.key === 'run-spend' ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'"
            >
              {{ stat.value }}
            </dd>
          </div>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped lang="scss">
  @use '@/styles/helpers';

  // Match design: compact dashboard titles (EGText defaults h1/h2 to 36px).
  .dashboard {
    :deep(h1) {
      font-size: toRem(24px);
      line-height: toRem(32px);
    }

    :deep(h2) {
      font-size: toRem(20px);
      line-height: toRem(28px);
    }
  }
</style>
