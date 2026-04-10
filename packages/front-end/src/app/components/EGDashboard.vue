<script setup lang="ts">
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
  import { Pipeline as SeqeraPipeline } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { WorkflowListItem as OmicsWorkflow } from '@aws-sdk/client-omics';
  import { useToastStore, useUiStore, useSeqeraPipelinesStore, useOmicsWorkflowsStore } from '@FE/stores';
  import { TableSort } from './EGTable.vue';

  const props = defineProps<{
    labId: string;
  }>();

  const { $api } = useNuxtApp();
  const $router = useRouter();
  const labStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();

  const lab = computed<Laboratory | null>(() => labStore.labs[props.labId] ?? null);
  const labName = computed<string>(() => lab.value?.Name || '');

  const allRuns = ref<LaboratoryRun[]>([]);
  const favouriteWorkflows = ref<FavouriteWorkflow[]>([]);
  const searchQuery = ref('');
  const searchFocused = ref(false);
  const overviewTimeFilter = ref<'7' | '30' | '90'>('30');

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
      const haystack = [run.RunName, run.WorkflowName, run.Owner, run.Status].filter(Boolean).join(' ').toLowerCase();
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
    }, 200);
  }

  const timeFilterOptions = [
    { label: 'Past 7 days', value: '7' },
    { label: 'Past 30 days', value: '30' },
    { label: 'Past 90 days', value: '90' },
  ];

  const filteredRunsForOverview = computed(() => {
    const now = Date.now();
    const days = parseInt(overviewTimeFilter.value);
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return allRuns.value.filter((run) => {
      const createdAt = run.CreatedAt ? new Date(run.CreatedAt).getTime() : 0;
      return createdAt >= cutoff;
    });
  });

  const activeRuns = computed(() =>
    filteredRunsForOverview.value.filter((r) => ['SUBMITTED', 'STARTING', 'RUNNING'].includes(r.Status)),
  );

  const completedRuns = computed(() =>
    filteredRunsForOverview.value.filter((r) => ['COMPLETED', 'SUCCEEDED'].includes(r.Status)),
  );

  const failedRuns = computed(() => filteredRunsForOverview.value.filter((r) => r.Status === 'FAILED'));

  const avgRunTime = computed(() => {
    const terminalRuns = filteredRunsForOverview.value.filter(
      (r) => r.CreatedAt && r.ModifiedAt && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.Status),
    );
    if (terminalRuns.length === 0) return '—';

    const totalMs = terminalRuns.reduce((sum, r) => {
      const start = new Date(r.CreatedAt!).getTime();
      const end = new Date(r.ModifiedAt!).getTime();
      return sum + Math.max(0, end - start);
    }, 0);

    const avgMs = totalMs / terminalRuns.length;
    const hours = avgMs / (1000 * 60 * 60);
    if (hours < 1) {
      const mins = Math.round(avgMs / (1000 * 60));
      return `${mins}m`;
    }
    return `${hours.toFixed(1)}h`;
  });

  const recentRuns = computed(() => {
    return [...allRuns.value]
      .sort((a, b) => {
        const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
        const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 5);
  });

  const recentRunsTableColumns = [
    { key: 'RunName', label: 'Run Name', sortable: true },
    { key: 'lastUpdated', label: 'Last Updated', sortable: true },
    { key: 'Status', label: 'Status', sortable: true },
    { key: 'actions', label: 'Actions' },
  ];

  const recentRunsSort = ref<TableSort>({ column: 'lastUpdated', direction: 'desc' });

  const recentRunsTableItems = computed(() =>
    recentRuns.value.map((run) => ({
      ...run,
      lastUpdated: run.ModifiedAt ?? run.CreatedAt ?? '',
    })),
  );

  const favouriteWorkflowsTableColumns = [
    { key: 'WorkflowName', label: 'Name' },
    { key: 'Description', label: 'Description' },
    { key: 'actions', label: 'Actions' },
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

  function workflowActionItems(workflow: FavouriteWorkflow): object[] {
    return [
      [{ label: 'Run', click: () => runFavouriteWorkflow(workflow) }],
      [{ label: 'Remove from Favourites', click: () => removeFavouriteWorkflow(workflow) }],
    ];
  }

  async function removeFavouriteWorkflow(workflow: FavouriteWorkflow) {
    const updated = favouriteWorkflows.value.filter(
      (w) => !(w.WorkflowId === workflow.WorkflowId && w.LaboratoryId === workflow.LaboratoryId),
    );
    try {
      await $api.users.updateUser(userStore.currentUserDetails.id!, { FavouriteWorkflows: updated });
      favouriteWorkflows.value = updated;
      useToastStore().success('Workflow removed from favourites');
    } catch {
      useToastStore().error('Failed to remove workflow from favourites');
    }
  }

  function navigateToOrg() {
    if (lab.value?.OrganizationId) {
      $router.push(`/orgs/${lab.value.OrganizationId}`);
    } else {
      $router.push('/labs');
    }
  }

  async function loadDashboardData() {
    uiStore.setRequestPending('loadDashboardData');
    try {
      await labStore.loadLab(props.labId);

      const labData = labStore.labs[props.labId];
      const promises: Promise<any>[] = [$api.labs.listLabRuns(props.labId), $api.users.getUser()];

      if (labData?.NextFlowTowerEnabled) {
        promises.push(seqeraPipelinesStore.loadPipelinesForLab(props.labId).catch(() => {}));
      }
      if (labData?.AwsHealthOmicsEnabled) {
        promises.push(omicsWorkflowsStore.loadWorkflowsForLab(props.labId).catch(() => {}));
      }

      const [runs, user] = await Promise.all(promises);

      allRuns.value = runs;
      favouriteWorkflows.value = (user.FavouriteWorkflows ?? []).filter(
        (w: FavouriteWorkflow) => w.LaboratoryId === props.labId,
      );
    } catch (error) {
      console.error('Error loading dashboard data', error);
    } finally {
      uiStore.setRequestComplete('loadDashboardData');
    }
  }

  onBeforeMount(loadDashboardData);

  const overviewStats = computed(() => [
    {
      icon: 'i-heroicons-beaker',
      value: activeRuns.value.length,
      label: 'Active Runs',
      bgColor: 'bg-primary-muted',
      iconColor: 'text-primary',
    },
    {
      icon: 'i-heroicons-check-circle',
      value: completedRuns.value.length,
      label: 'Completed Runs',
      bgColor: 'bg-alert-success-muted',
      iconColor: 'text-alert-success',
    },
    {
      icon: 'i-heroicons-x-circle',
      value: failedRuns.value.length,
      label: 'Failed Runs',
      bgColor: 'bg-alert-danger-muted',
      iconColor: 'text-alert-danger',
    },
    {
      icon: 'i-heroicons-clock',
      value: avgRunTime.value,
      label: 'Avg Run time',
      bgColor: 'bg-background-light-grey',
      iconColor: 'text-muted',
    },
  ]);
</script>

<template>
  <div class="dashboard">
    <!-- Header: Title + Search -->
    <div class="mb-2 flex items-center justify-between">
      <div>
        <button class="text-primary mb-2 flex items-center gap-1 text-sm font-medium" @click="navigateToOrg">
          <UIcon name="i-heroicons-arrow-left" class="h-4 w-4" />
          Back to organisation
        </button>
        <EGText tag="h1" class="mb-0">Laboratory of {{ labName }}</EGText>
      </div>
      <div class="relative w-[320px]">
        <UInput
          v-model="searchQuery"
          placeholder="Search Runs, Workflows, Results"
          icon="i-heroicons-magnifying-glass-20-solid"
          autocomplete="off"
          :trailing="true"
          :ui="{
            placeholder: 'placeholder-text-muted',
            focus: 'outline-none border-0',
            icon: { base: 'text-neutral-black w-[24px] h-[24px]' },
            padding: { sm: 'px-5 py-4' },
            color: { white: { outline: 'shadow-none focus:ring-1' } },
          }"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
        />

        <div
          v-if="showDropdown"
          class="absolute right-0 top-full z-50 mt-1 w-[420px] overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-lg"
        >
          <div v-if="searchResults.length === 0" class="text-muted px-4 py-6 text-center text-sm">No results found</div>
          <ul v-else class="max-h-[360px] overflow-y-auto">
            <li
              v-for="result in searchResults"
              :key="`${result.type}-${result.id}`"
              class="hover:bg-background-light-grey flex cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0"
              @mousedown.prevent="selectSearchResult(result)"
            >
              <UIcon
                :name="result.type === 'run' ? 'i-heroicons-clock' : 'i-heroicons-command-line'"
                class="text-muted h-5 w-5 shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="text-body truncate text-sm font-medium">{{ result.name }}</div>
                <div v-if="result.subtitle" class="text-muted truncate text-xs">{{ result.subtitle }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <EGStatusChip v-if="result.status" :status="result.status" />
                <span class="text-muted whitespace-nowrap text-xs">{{ resultTypeLabel(result.type) }}</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Dashboard Overview -->
    <div class="mt-8">
      <div class="flex items-center justify-between">
        <EGText tag="h3" class="mb-0">Dashboard overview</EGText>
        <select
          v-model="overviewTimeFilter"
          class="text-body rounded-lg border border-neutral-100 bg-white px-4 py-2 text-sm"
        >
          <option v-for="opt in timeFilterOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="mt-4 grid grid-cols-4 gap-4">
        <div
          v-for="(stat, i) in overviewStats"
          :key="i"
          class="flex items-center gap-4 rounded-2xl border border-neutral-100 bg-white p-6"
        >
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" :class="stat.bgColor">
            <UIcon :name="stat.icon" class="h-6 w-6" :class="stat.iconColor" />
          </div>
          <div>
            <div class="text-heading font-serif text-3xl font-semibold">{{ stat.value }}</div>
            <div class="text-muted text-sm">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Runs -->
    <div class="mt-10">
      <EGText tag="h3" class="mb-8">Recent Runs</EGText>

      <EGTable
        :row-click-action="viewRunDetails"
        :table-data="recentRunsTableItems"
        :columns="recentRunsTableColumns"
        v-model:sort="recentRunsSort"
        :is-loading="uiStore.isRequestPending('loadDashboardData')"
        :show-pagination="false"
      >
        <template #RunName-data="{ row: run }">
          <div v-if="run.RunName" class="text-body text-sm font-medium">{{ run.RunName }}</div>
          <div v-if="run.WorkflowName" class="text-muted text-xs font-normal">{{ run.WorkflowName }}</div>
        </template>

        <template #lastUpdated-data="{ row: run }">
          <div class="text-body text-sm font-medium">{{ getDate(run.lastUpdated) }}</div>
          <div class="text-muted text-xs">{{ getTime(run.lastUpdated) }}</div>
        </template>

        <template #Status-data="{ row: run }">
          <EGStatusChip :status="run.Status" />
        </template>

        <template #actions-data="{ row }">
          <div class="flex justify-end">
            <EGActionButton :items="runsActionItems(row)" class="ml-2" @click="$event.stopPropagation()" />
          </div>
        </template>

        <template #empty-state>
          <div class="text-muted flex h-24 items-center justify-center font-normal">No recent runs</div>
        </template>
      </EGTable>
    </div>

    <!-- Favourite Workflows -->
    <div class="mt-10">
      <div class="mb-8">
        <EGText tag="h3" class="mb-0">Favourite Workflows</EGText>
        <p class="text-muted text-sm">Quick launch your most used workflows.</p>
      </div>

      <EGTable
        :table-data="displayedFavouriteWorkflows"
        :columns="favouriteWorkflowsTableColumns"
        :is-loading="uiStore.isRequestPending('loadDashboardData')"
        :show-pagination="false"
      >
        <template #WorkflowName-data="{ row: workflow }">
          <div class="text-body text-sm font-semibold">{{ workflow.WorkflowName }}</div>
        </template>

        <template #Description-data="{ row: workflow }">
          <div class="text-muted text-sm">{{ workflow.Description || '—' }}</div>
        </template>

        <template #actions-data="{ row }">
          <div class="flex justify-end">
            <EGActionButton :items="workflowActionItems(row)" class="ml-2" @click="$event.stopPropagation()" />
          </div>
        </template>

        <template #empty-state>
          <div class="text-muted flex h-24 items-center justify-center font-normal">No favourite workflows yet</div>
        </template>
      </EGTable>
    </div>
  </div>
</template>
