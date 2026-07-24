<script setup lang="ts">
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    WorkflowProgressResponse,
    Workflow,
  } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { ReadRunTasks } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
  import { TaskListItem, GetRunResponse } from '@aws-sdk/client-omics';
  import { useLabsStore, useRunStore, useUiStore } from '@FE/stores';
  import { ensureLabInActiveOrg } from '@FE/utils/ensure-lab-in-active-org';

  const TERMINAL_STATUSES = new Set(['FAILED', 'SUCCEEDED', 'CANCELLED', 'COMPLETED', 'DELETED', 'ABORTED']);
  const DETAIL_PROGRESS_POLL_MS = 30 * 1000;

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
  // Full workflow detail for FAILED Seqera runs (errorMessage, errorReport)
  const seqeraRunDetail = ref<Workflow | null>(null);
  // Live Omics task progress (RUNNING / FAILED)
  const omicsProgress = ref<ReadRunTasks | null>(null);
  // Task-level data for FAILED Omics runs
  const omicsFailedTasks = ref<TaskListItem[]>([]);
  // Full run detail for FAILED Omics runs (failureReason, statusMessage)
  const omicsRunDetail = ref<GetRunResponse | null>(null);

  let progressPollTimeoutId: number | undefined;

  onBeforeMount(async () => {
    if (await ensureLabInActiveOrg({ labId })) {
      return;
    }
    await fetchLabRuns();
    scheduleProgressPoll();
  });

  onBeforeUnmount(() => {
    if (progressPollTimeoutId != null) {
      window.clearTimeout(progressPollTimeoutId);
      progressPollTimeoutId = undefined;
    }
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

  function scheduleProgressPoll() {
    if (progressPollTimeoutId != null) {
      window.clearTimeout(progressPollTimeoutId);
    }
    const run = runStore.labRuns[labRunId];
    if (!run || TERMINAL_STATUSES.has(run.Status)) return;

    progressPollTimeoutId = window.setTimeout(async () => {
      try {
        await runStore.loadLabRunsForLab(labId);
        await fetchTaskProgress({ silent: true });
      } catch (error) {
        console.error('Failed to poll run progress:', error);
      } finally {
        scheduleProgressPoll();
      }
    }, DETAIL_PROGRESS_POLL_MS);
  }

  async function fetchTaskProgress(options: { silent?: boolean } = {}) {
    const run = runStore.labRuns[labRunId];
    if (!run?.ExternalRunId) return;

    if (run.Platform === 'Seqera Cloud' && ['FAILED', 'RUNNING'].includes(run.Status)) {
      try {
        seqeraProgress.value = await $api.seqeraRuns.getWorkflowProgress(labId, run.ExternalRunId);
      } catch (error) {
        console.error('Failed to fetch Seqera workflow progress:', error);
        if (!options.silent) {
          useToastStore().error('Could not load Seqera task progress for this run.');
        }
      }
      if (run.Status === 'FAILED') {
        try {
          seqeraRunDetail.value = await $api.seqeraRuns.get(labId, run.ExternalRunId);
        } catch (error) {
          console.error('Failed to fetch Seqera workflow detail:', error);
          if (!options.silent) {
            useToastStore().error('Could not load Seqera failure details for this run.');
          }
        }
      }
    }

    if (
      run.Platform === 'AWS HealthOmics' &&
      ['FAILED', 'RUNNING', 'STARTING', 'PENDING', 'STOPPING'].includes(run.Status)
    ) {
      try {
        const progressResponse = await $api.omicsRuns.getRunProgress(labId, run.ExternalRunId);
        omicsProgress.value = progressResponse;
        if (run.Status === 'FAILED') {
          omicsFailedTasks.value = (progressResponse.tasks ?? []).filter((t) => t.status === 'FAILED');
        }
      } catch (error) {
        console.error('Failed to fetch Omics run task progress:', error);
        if (!options.silent) {
          useToastStore().error('Could not load HealthOmics task progress for this run.');
        }
      }
      if (run.Status === 'FAILED') {
        try {
          omicsRunDetail.value = await $api.omicsRuns.get(labId, run.ExternalRunId);
        } catch (error) {
          console.error('Failed to fetch Omics run details:', error);
          if (!options.silent) {
            useToastStore().error('Could not load HealthOmics failure details for this run.');
          }
        }
      }
    }
  }

  const omicsFailureReason = computed<string | null>(
    () =>
      omicsRunDetail.value?.failureReason ?? omicsRunDetail.value?.statusMessage ?? labRun.value?.FailureReason ?? null,
  );

  const seqeraFailureReason = computed<string | null>(
    () => seqeraRunDetail.value?.errorMessage ?? labRun.value?.FailureReason ?? null,
  );

  const seqeraErrorReport = computed<string | null>(() => seqeraRunDetail.value?.errorReport ?? null);

  // Classification block surfaces FailureOwner / FailureSummary / FailureAction populated by the
  // backend classifier (deterministic lookup for documented HealthOmics codes, LLM for ambiguous
  // ones and all Seqera errors). Shown above the platform-specific failure-reason banner.
  const failureClassificationVisible = computed<boolean>(() => !!labRun.value?.FailureOwner);
  const failureOwnerBadgeClass = computed<string>(() => {
    switch (labRun.value?.FailureOwner) {
      case 'Lab':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      case 'Bioinformatician':
        return 'bg-red-100 text-red-900 border-red-200';
      case 'AWS':
        return 'bg-blue-100 text-blue-900 border-blue-200';
      case 'Ambiguous':
      default:
        return 'bg-gray-100 text-gray-900 border-gray-200';
    }
  });

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

  usePageTitle(() => (labRun.value?.RunName ? labRun.value.RunName : 'Run details'));

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

  <EGDetailTabs
    :model-value="tabIndex"
    :items="tabItems"
    aria-label="Laboratory run sections"
    @update:model-value="handleTabChange"
  >
    <template #default="{ item }">
      <!-- Run Details -->
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          v-if="labRun"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
          <h2 class="sr-only">Run details</h2>
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

        <!-- Failure classification (owner + summary + suggested action). Populated asynchronously
             by the classifier Lambda when a run reaches FAILED; absent on older rows or while the
             classifier is still working. -->
        <section
          v-if="failureClassificationVisible"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 max-md:px-5"
        >
          <h3 class="mb-4 text-sm font-medium text-black">Failure analysis</h3>
          <div class="space-y-2">
            <div class="flex items-center gap-3">
              <span
                class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
                :class="failureOwnerBadgeClass"
              >
                Owner: {{ labRun?.FailureOwner }}
              </span>
              <span v-if="labRun?.FailureClassifiedBy === 'llm'" class="text-muted text-xs italic">
                AI-assisted classification — verify before acting
              </span>
            </div>
            <p v-if="labRun?.FailureSummary" class="text-sm text-black">{{ labRun.FailureSummary }}</p>
            <p v-if="labRun?.FailureAction" class="text-muted text-sm">
              <span class="font-medium text-black">What to do next:</span>
              {{ labRun.FailureAction }}
            </p>
          </div>
        </section>

        <!-- Seqera task-level progress for FAILED or RUNNING runs -->
        <section
          v-if="labRun?.Platform === 'Seqera Cloud' && (seqeraFailureReason || seqeraProgress?.progress)"
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 max-md:px-5"
        >
          <h3 class="mb-4 text-sm font-medium text-black">Task Breakdown</h3>
          <div v-if="seqeraFailureReason" class="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm">
            <p class="font-medium text-red-800">Failure reason</p>
            <p class="text-red-700">{{ seqeraFailureReason }}</p>
            <details v-if="seqeraErrorReport" class="mt-2">
              <summary class="cursor-pointer text-xs text-red-600">Show full error report</summary>
              <pre class="mt-2 whitespace-pre-wrap break-all text-xs text-red-600">{{ seqeraErrorReport }}</pre>
            </details>
          </div>
          <template v-if="seqeraProgress?.progress">
            <ul class="mb-4 flex flex-wrap gap-6 text-sm" aria-label="Task counts by status">
              <li>
                <span class="font-medium text-green-700">Succeeded:</span>
                {{ seqeraProgress.progress.workflowProgress?.succeedCountFmt ?? '0' }}
              </li>
              <li>
                <span class="font-medium text-red-700">Failed:</span>
                {{ seqeraProgress.progress.workflowProgress?.failedCountFmt ?? '0' }}
              </li>
              <li>
                <span class="text-body font-medium">Running:</span>
                {{ seqeraProgress.progress.workflowProgress?.runningCountFmt ?? '0' }}
              </li>
            </ul>
            <div v-if="seqeraProgress.progress.processesProgress?.length" class="space-y-2">
              <div
                v-for="proc in seqeraProgress.progress.processesProgress?.filter((p) => p.failed > 0)"
                :key="proc.process"
                class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm"
              >
                <p class="font-medium text-red-800">
                  <span class="sr-only">Failed process:</span>
                  {{ proc.process }}
                </p>
                <p class="text-red-600">{{ proc.failed }} task(s) failed</p>
              </div>
            </div>
          </template>
        </section>

        <!-- Omics task progress + failures -->
        <section
          v-if="
            labRun?.Platform === 'AWS HealthOmics' &&
            (omicsFailureReason ||
              omicsFailedTasks.length ||
              (omicsProgress?.progress && !TERMINAL_STATUSES.has(labRun.Status)))
          "
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 max-md:px-5"
        >
          <h3 class="mb-4 text-sm font-medium text-black">
            {{ labRun.Status === 'FAILED' ? 'Failed Tasks' : 'Task Progress' }}
          </h3>
          <div v-if="omicsProgress?.progress && !TERMINAL_STATUSES.has(labRun.Status)" class="mb-4">
            <EGProgressBar
              :percent="omicsProgress.progress.percent"
              :completed="omicsProgress.progress.tasksCompleted"
              :total="omicsProgress.progress.tasksTotal"
            />
            <ul class="mt-3 flex flex-wrap gap-6 text-sm" aria-label="Task counts by status">
              <li>
                <span class="font-medium text-green-700">Completed:</span>
                {{ omicsProgress.progress.tasksCompleted }}
              </li>
              <li>
                <span class="text-body font-medium">Running:</span>
                {{ omicsProgress.progress.tasksRunning }}
              </li>
              <li>
                <span class="font-medium text-red-700">Failed:</span>
                {{ omicsProgress.progress.tasksFailed }}
              </li>
              <li>
                <span class="text-muted font-medium">Total known:</span>
                {{ omicsProgress.progress.tasksTotal }}
              </li>
            </ul>
          </div>
          <div v-if="omicsFailureReason" class="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm">
            <p class="font-medium text-red-800">Failure reason</p>
            <p class="text-red-700">{{ omicsFailureReason }}</p>
          </div>
          <div class="space-y-2">
            <div
              v-for="task in omicsFailedTasks"
              :key="task.taskId"
              class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm"
            >
              <p class="font-medium text-red-800">
                <span class="sr-only">Failed task:</span>
                Task {{ task.taskId }} — {{ task.name }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <!-- File Manager -->
      <div v-if="item.key === 'fileManager'" class="space-y-3">
        <EGFileExplorer
          v-if="s3Bucket && s3Prefix"
          :lab-id="labId"
          :run-id="labRunId"
          :s3-bucket="s3Bucket"
          :s3-prefix="s3Prefix"
          :start-path="outputPath"
        />
        <p v-else-if="labRun && !isLoading" class="text-muted rounded-lg border border-dashed p-6 text-center text-sm">
          No S3 location is recorded for this run, so files cannot be listed.
        </p>
      </div>
    </template>
  </EGDetailTabs>
</template>
