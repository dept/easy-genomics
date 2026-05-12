<script setup lang="ts">
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { WorkflowProgressResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { RunTask } from '@aws-sdk/client-omics';
  import { useLabsStore, useRunStore, useUiStore } from '@FE/stores';

  const $route = useRoute();
  const $router = useRouter();
  const { $api } = useNuxtApp();
  const { handleS3Download } = useFileDownload();
  const { platformToPipelineOrWorkflow } = useMultiplatform();

  const labsStore = useLabsStore();
  const runStore = useRunStore();
  const uiStore = useUiStore();

  const labId = $route.params.labId as string;
  const labRunId = $route.params.labRunId as string;

  const lab = computed<Laboratory | null>(() => labsStore.labs[labId] ?? null);
  const labRun = computed<LaboratoryRun | null>(() => runStore.labRuns[labRunId] ?? null);
  // Prefer OutputS3Url as the authoritative reference for the File Manager root when available (supports custom output dirs).
  // Fall back to InputS3Url for legacy runs where OutputS3Url was not set.
  const inputS3Url = computed<string | null>(() => labRun.value?.InputS3Url ?? null);
  const outputS3Url = computed<string | null>(() => labRun.value?.OutputS3Url ?? null);
  const effectiveRootS3Url = computed<string | null>(() => outputS3Url.value ?? inputS3Url.value);
  const s3Bucket = computed<string | null>(
    () => effectiveRootS3Url.value?.match(/(?<=^s3:\/\/)([a-z0-9][a-z0-9-]{1,61}[a-z0-9])(?=\/*)/g)?.toString() ?? null,
  );
  const s3Prefix = computed<string | null>(
    () => effectiveRootS3Url.value?.match(/(?<=^s3:\/\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/)(.*)/g)?.toString() ?? null,
  );

  const outputPath = computed<string[] | null>(() => {
    const run = labRun.value;
    const outputUrl = run?.OutputS3Url ?? null;
    const inputUrl = inputS3Url.value;

    // If we have an explicit OutputS3Url, the File Manager root is that location.
    // For AWS HealthOmics runs, Omics generates an additional sub-folder with the ExternalRunId
    // which we still want to auto-descend into.
    if (outputUrl) {
      if (run?.Platform === 'AWS HealthOmics' && !!run.ExternalRunId) {
        return [run.ExternalRunId];
      }
      return null;
    }

    if (!inputUrl) return null;

    // get length of shared prefix
    let i = 0;
    while (inputUrl[i] === outputUrl[i]) i++;

    let outputRelativeLocation = (run?.OutputS3Url ?? '').slice(i);
    if (!outputRelativeLocation.match(/^(\/[^\/]+)+$/)) return null;

    // omics generates an additional sub-folder with the omics run id which we also want to descend into
    if (labRun.value?.Platform === 'AWS HealthOmics' && !!labRun.value?.ExternalRunId) {
      outputRelativeLocation += '/' + labRun.value.ExternalRunId;
    }

    return outputRelativeLocation.split('/').filter((step) => !!step); // filter out blank steps ie ''
  });

  const isLoading = computed<boolean>(() => uiStore.isRequestPending('loadLabRuns'));

  // permission check
  if (!useUserStore().canViewLab(labId)) {
    $router.push('/labs');
  }

  // Task-level progress for FAILED/RUNNING Seqera runs
  const seqeraProgress = ref<WorkflowProgressResponse | null>(null);
  // Task-level data for FAILED Omics runs
  const omicsFailedTasks = ref<RunTask[]>([]);

  onBeforeMount(async () => {
    await fetchLabRuns();
  });

  async function fetchLabRuns() {
    uiStore.setRequestPending('loadLabRuns');
    try {
      await runStore.loadLabRunsForLab(labId);
      await fetchTaskProgress();
    } finally {
      uiStore.setRequestComplete('loadLabRuns');
    }
  }

  async function fetchTaskProgress() {
    const run = runStore.labRuns[labRunId];
    if (!run?.ExternalRunId) return;

    if (run.Platform === 'Seqera Cloud' && ['FAILED', 'RUNNING'].includes(run.Status)) {
      try {
        seqeraProgress.value = await $api.seqeraRuns.getWorkflowProgress(labId, run.ExternalRunId);
      } catch (error) {
        console.error('Failed to fetch Seqera workflow progress:', error);
      }
    }

    if (run.Platform === 'AWS HealthOmics' && run.Status === 'FAILED') {
      try {
        const omicsRun = await $api.omicsRuns.get(labId, run.ExternalRunId);
        omicsFailedTasks.value = (omicsRun.tasks ?? []).filter((t: RunTask) => t.status === 'FAILED');
      } catch (error) {
        console.error('Failed to fetch Omics run task details:', error);
      }
    }
  }

  const tabItems = computed(() => [
    { key: 'runDetails', label: 'Run Details' },
    { key: 'fileManager', label: 'File Manager' },
  ]);
  const tabIndex = ref(0);

  function setTabIndexFromQuery() {
    const queryTabMatchIndex = tabItems.value.findIndex((tab) => tab.label === $route.query.tab);
    tabIndex.value = queryTabMatchIndex !== -1 ? queryTabMatchIndex : 0;
  }

  onMounted(setTabIndexFromQuery);

  const updateQueryParams = useDebounceFn((params: Record<string, string | undefined>) => {
    $router.replace({ path: $route.path, query: { ...$route.query, ...params } });
  }, 300);

  function handleTabChange(newIndex: number) {
    tabIndex.value = newIndex;
    updateQueryParams({ tab: tabItems.value[newIndex]?.label });
  }

  const pipelineOrWorkflow = computed<string | null>(() =>
    !labRun.value?.Platform ? null : platformToPipelineOrWorkflow(labRun.value.Platform),
  );

  async function downloadSampleSheet(): Promise<void> {
    const sampleSheetUrl = labRun.value?.SampleSheetS3Url;
    if (!sampleSheetUrl) {
      useToastStore().error('Sample Sheet url not available');
      return;
    }

    const path = sampleSheetUrl.replace(/\/[^/]+$/, '');
    const fileName = sampleSheetUrl.split('/').at(-1);

    uiStore.setRequestPending('downloadSampleSheet');
    try {
      await handleS3Download(labId, fileName!, path);
    } finally {
      uiStore.setRequestComplete('downloadSampleSheet');
    }
  }

  const rowStyle = 'flex border-b p-6 text-sm';
  const rowLabelStyle = 'w-[200px] font-medium text-black';
  const rowContentStyle = 'text-muted text-left';

  // Note: the UTabs :ui attribute has to be defined locally in this file - if it is imported from another file,
  //  Tailwind won't pick up and include the classes used and styles will be missing.
  // To keep the tab styling consistent throughout the app, any changes made here need to be duplicated to all other
  //  UTabs that use an "EGTabsStyles" as input to the :ui attribute.
  const EGTabsStyles = {
    base: 'focus:outline-none',
    list: {
      base: '!flex rounded-none mb-6 mt-0',
      padding: 'p-0',
      height: 'h-14',
      marker: {
        background: '',
        shadow: '',
      },
      tab: {
        base: 'font-serif w-auto mr-3 rounded-xl border border-solid',
        background: '',
        active: 'text-white bg-primary border-primary',
        inactive: 'font-serif text-text-body border-background-dark-grey',
        height: '',
        padding: 'px-5 py-2',
        size: 'text-sm',
      },
    },
  };
</script>

<template>
  <EGPageHeader
    :title="labRun?.RunName || ''"
    :description="labRun?.WorkflowName || ''"
    :show-back="true"
    :back-action="() => $router.push(`/labs/${labId}?tab=Lab Runs`)"
    :is-loading="isLoading"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[labRun?.RunName]"
  />

  <UTabs :ui="EGTabsStyles" v-model="tabIndex" :items="tabItems" @update:model-value="handleTabChange">
    <template #item="{ item }">
      <!-- Run Details -->
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          v-if="labRun"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
          <dl class="mt-4 space-y-0">
            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Run Name</dt>
              <dd :class="rowContentStyle">{{ labRun.RunName }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">{{ pipelineOrWorkflow }}</dt>
              <dd :class="rowContentStyle">{{ labRun.WorkflowName }}</dd>
            </div>

            <div v-if="labRun.Platform === 'AWS HealthOmics'" :class="rowStyle">
              <dt :class="rowLabelStyle">Workflow version</dt>
              <dd :class="rowContentStyle">{{ labRun.WorkflowVersionName || '—' }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">{{ pipelineOrWorkflow }} Run Status</dt>
              <dd :class="rowContentStyle">
                <EGStatusChip :status="labRun.Status" />
              </dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Platform</dt>
              <dd :class="rowContentStyle">{{ labRun.Platform }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Owner</dt>
              <dd :class="rowContentStyle">{{ labRun.Owner }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Internal Run Id</dt>
              <dd :class="rowContentStyle">{{ labRun.RunId }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">External Run Id</dt>
              <dd :class="rowContentStyle">{{ labRun.ExternalRunId }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Sample Sheet</dt>
              <dd :class="rowContentStyle" style="width: 90%">
                <EGS3SampleSheetBar
                  :url="labRun.SampleSheetS3Url"
                  :lab-id="labId"
                  :lab-name="lab?.Name ?? ''"
                  :pipeline-or-workflow-name="labRun.WorkflowName"
                  :platform="labRun.Platform"
                  :run-name="labRun.RunName"
                  :display-label="false"
                />
              </dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Created</dt>
              <dd :class="rowContentStyle">{{ `${getTime(labRun.CreatedAt)} ⋅ ${getDate(labRun.CreatedAt)}` }}</dd>
            </div>

            <div :class="rowStyle" v-if="labRun.ModifiedAt">
              <dt :class="rowLabelStyle">Last Modified</dt>
              <dd :class="rowContentStyle">
                {{ `${getTime(labRun.ModifiedAt)} ⋅ ${getDate(labRun.ModifiedAt)}` }}
              </dd>
            </div>
          </dl>
        </section>

        <!-- Seqera task-level progress for FAILED or RUNNING runs -->
        <section
          v-if="labRun?.Platform === 'Seqera Cloud' && seqeraProgress?.progress"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 max-md:px-5"
        >
          <h3 class="mb-4 text-sm font-medium text-black">Task Breakdown</h3>
          <div class="mb-4 flex gap-6 text-sm">
            <span class="text-green-700">
              Succeeded: {{ seqeraProgress.progress.workflowProgress?.succeedCountFmt ?? '0' }}
            </span>
            <span class="text-red-700">
              Failed: {{ seqeraProgress.progress.workflowProgress?.failedCountFmt ?? '0' }}
            </span>
            <span class="text-muted">
              Running: {{ seqeraProgress.progress.workflowProgress?.runningCountFmt ?? '0' }}
            </span>
          </div>
          <div v-if="seqeraProgress.progress.processesProgress?.length" class="space-y-2">
            <div
              v-for="proc in seqeraProgress.progress.processesProgress?.filter((p) => p.failed > 0)"
              :key="proc.process"
              class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm"
            >
              <p class="font-medium text-red-800">{{ proc.process }}</p>
              <p class="text-red-600">{{ proc.failed }} task(s) failed</p>
            </div>
          </div>
        </section>

        <!-- Omics task-level failures for FAILED runs -->
        <section
          v-if="labRun?.Platform === 'AWS HealthOmics' && omicsFailedTasks.length"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 max-md:px-5"
        >
          <h3 class="mb-4 text-sm font-medium text-black">Failed Tasks</h3>
          <div class="space-y-2">
            <div
              v-for="task in omicsFailedTasks"
              :key="task.taskId"
              class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm"
            >
              <p class="font-medium text-red-800">Task {{ task.taskId }} — {{ task.name }}</p>
              <p v-if="task.statusMessage" class="text-red-600">{{ task.statusMessage }}</p>
            </div>
          </div>
        </section>
      </div>

      <!-- File Manager -->
      <div v-if="item.key === 'fileManager'" class="space-y-3">
        <EGFileExplorer
          :lab-id="labId"
          :run-id="labRunId"
          :s3-bucket="s3Bucket"
          :s3-prefix="s3Prefix"
          :start-path="outputPath"
        />
      </div>
    </template>
  </UTabs>
</template>
