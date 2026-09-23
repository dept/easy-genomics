<script setup lang="ts">
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    WorkflowProgressResponse,
    Workflow,
  } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { getRunDetailProgressPollIntervalMs } from '@easy-genomics/shared-lib/src/app/utils/laboratory-run-progress-polling';
  import { ReadRunTasks } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
  import { TaskListItem, GetRunResponse } from '@aws-sdk/client-omics';
  import { useLabsStore, useRunStore, useUiStore } from '@FE/stores';
  import { ensureLabInActiveOrg } from '@FE/utils/ensure-lab-in-active-org';
  import {
    isTerminalRunStatus,
    showOmicsTaskProgressCard,
    showSeqeraTaskProgressCard,
  } from '@FE/utils/run-progress-card-visibility';
  import { v4 as uuidv4 } from 'uuid';
  import { analysisErrorMessage } from '@FE/utils/analysis-error-message';
  import { analysisEvidenceMessage } from '@FE/utils/analysis-evidence-message';
  import { toSentenceCase } from '@FE/utils/string-utils';

  const $route = useRoute();
  const $router = useRouter();
  const { $api } = useNuxtApp();
  const { handleS3Download } = useFileDownload();
  const { platformToPipelineOrWorkflow } = useMultiplatform();

  const labsStore = useLabsStore();
  const runStore = useRunStore();
  const uiStore = useUiStore();
  useInitialPendingRequests('loadLabRuns');

  const labId = $route.params.labId as string;
  const labRunId = $route.params.labRunId as string;
  const { labTab } = useLabBreadcrumbs(labId);

  const lab = computed<Laboratory | null>(() => labsStore.labs[labId] ?? null);
  const detailProgressPollIntervalMs = computed<number>(() =>
    getRunDetailProgressPollIntervalMs(lab.value?.RunDetailProgressPollIntervalSeconds),
  );
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
  // Guard so an in-flight poll's `finally` cannot reschedule after unmount.
  let progressPollActive = false;

  onBeforeMount(async () => {
    if (await ensureLabInActiveOrg({ labId, forceReload: true })) {
      uiStore.setRequestComplete('loadLabRuns');
      return;
    }
    if (!labsStore.labs[labId]) {
      await labsStore.loadLab(labId);
    }
    await fetchLabRuns();
    progressPollActive = true;
    scheduleProgressPoll();
  });

  onBeforeUnmount(() => {
    progressPollActive = false;
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
    if (!progressPollActive) return;
    if (progressPollTimeoutId != null) {
      window.clearTimeout(progressPollTimeoutId);
    }
    const run = runStore.labRuns[labRunId];
    if (!run || isTerminalRunStatus(run.Status)) return;

    progressPollTimeoutId = window.setTimeout(async () => {
      if (!progressPollActive) return;
      try {
        await runStore.loadLabRunsForLab(labId);
        await fetchTaskProgress({ silent: true });
      } catch (error) {
        console.error('Failed to poll run progress:', error);
      } finally {
        if (progressPollActive) {
          scheduleProgressPoll();
        }
      }
    }, detailProgressPollIntervalMs.value);
  }

  watch(detailProgressPollIntervalMs, (next, prev) => {
    if (!progressPollActive || next === prev) return;
    scheduleProgressPoll();
  });

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

  // Only an Ambiguous verdict needs explaining, and only when the analysis
  // actually succeeded — a Failed analysis shows its own error copy instead, and
  // its AnalysisEvidence may be left over from an earlier run.
  const ambiguousEvidenceNote = computed<string | undefined>(() => {
    if (labRun.value?.FailureOwner !== 'Ambiguous') return undefined;
    if (labRun.value?.AnalysisStatus !== 'Succeeded') return undefined;
    return analysisEvidenceMessage(labRun.value?.AnalysisEvidence);
  });

  const isHealthOmics = computed<boolean>(() => labRun.value?.Platform === 'AWS HealthOmics');
  const isFailed = computed<boolean>(() => labRun.value?.Status?.toUpperCase() === 'FAILED');

  // Retry is HealthOmics-only and relaunches the wizard pre-filled from this run. The workflow id
  // comes from the GetRun response loaded for failed runs (it isn't stored on the LaboratoryRun).
  const retryWorkflowId = computed<string | null>(() => omicsRunDetail.value?.workflowId ?? null);
  const canRetry = computed<boolean>(() => isHealthOmics.value && isFailed.value && !!retryWorkflowId.value);

  function retryRun() {
    const workflowId = retryWorkflowId.value;
    if (!workflowId) return;

    $router.push({
      path: `/labs/${labId}/run-workflow/${workflowId}`,
      query: { omicsRunTempId: uuidv4(), retryFromRunId: labRunId },
    });
  }

  const analysisStatus = computed<string | undefined>(() => labRun.value?.AnalysisStatus);
  // Local pending covers the window between the click and the first poll, which
  // the server-derived status cannot: AnalysisStatus is a poll interval behind.
  const analysisInFlight = computed<boolean>(
    () =>
      !!runStore.analysisRequestPending[labRunId] ||
      analysisStatus.value === 'Queued' ||
      analysisStatus.value === 'Running',
  );

  const analysisStalled = computed<boolean>(() => !!runStore.analysisStalled[labRunId]);

  function checkAnalysisAgain() {
    runStore.startAnalysisPolling(labRunId);
  }

  // A button that can only ever fail is worse than no button, so it appears
  // only when the lab actually has a provider and model configured.
  const labHasLlmConfigured = computed<boolean>(() => {
    if (!lab.value) return false;
    return isHealthOmics.value
      ? !!lab.value.HealthOmicsLlmProvider && !!lab.value.HealthOmicsLlmModelId
      : !!lab.value.SeqeraLlmProvider && !!lab.value.SeqeraLlmModelId;
  });

  // Master switch: hidden for everyone (tech and admin alike) when the lab has
  // turned AI error analysis off — `!== false` so a lab that predates the field
  // keeps today's behaviour with no data migration.
  const failureAnalysisEnabled = computed<boolean>(() => lab.value?.FailureAnalysisEnabled !== false);

  const canRequestAnalysis = computed<boolean>(
    () => isFailed.value && labHasLlmConfigured.value && failureAnalysisEnabled.value,
  );
  const analysisButtonLabel = computed<string>(() =>
    labRun.value?.FailureOwner ? 'Re-run AI analysis' : 'Run AI analysis',
  );

  async function requestAnalysis() {
    await runStore.requestFailureAnalysis(labId, labRunId);
  }

  // A page load/reload while AnalysisStatus is already Queued/Running has no poll
  // running for it (e.g. the SQS send failed, or the consumer's message died in a
  // DLQ) — the button would otherwise stay stuck on "Analysing…" forever. Resume
  // the existing poll (with its own terminal-status detection and timeout) whenever
  // the in-flight state is observed and nothing is polling it yet. `labRun` loads
  // asynchronously after mount, so this is a watcher rather than onMounted logic.
  watch(
    labRun,
    (run) => {
      if (!run) return;
      const inFlight = run.AnalysisStatus === 'Queued' || run.AnalysisStatus === 'Running';
      if (inFlight && !runStore.analysisPolls[labRunId] && !runStore.analysisStalled[labRunId]) {
        runStore.startAnalysisPolling(labRunId);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => runStore.stopAnalysisPolling(labRunId));

  const tabItems = computed(() => [
    { key: 'runDetails', label: 'Overview' },
    { key: 'fileManager', label: 'Files' },
  ]);

  // Tab selection is round-tripped through `?tab=<label>`, so renaming the tabs
  // would strand links already shared with the previous labels.
  const LEGACY_TAB_LABELS: Record<string, string> = {
    'Run Details': 'Overview',
    'File Manager': 'Files',
  };
  const tabIndex = ref(0);

  function setTabIndexFromQuery() {
    const requestedTab = String($route.query.tab ?? '');
    const resolvedTab = LEGACY_TAB_LABELS[requestedTab] ?? requestedTab;
    const queryTabMatchIndex = tabItems.value.findIndex((tab) => tab.label === resolvedTab);
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
  const rowLabelStyle = 'w-[200px] shrink-0 font-medium text-black';
  const rowContentStyle = 'min-w-0 flex-1 break-words text-muted text-left';

  /** The failure card is platform-agnostic; each platform supplies the reason differently. */
  const platformFailureReason = computed<string | null>(() =>
    isHealthOmics.value ? omicsFailureReason.value : seqeraFailureReason.value,
  );
  const platformErrorReport = computed<string | null>(() => (isHealthOmics.value ? null : seqeraErrorReport.value));

  const showSeqeraProgressCard = computed<boolean>(() =>
    showSeqeraTaskProgressCard(labRun.value, {
      failureReason: seqeraFailureReason.value,
      hasProgress: !!seqeraProgress.value?.progress,
    }),
  );

  const showOmicsProgressCard = computed<boolean>(() =>
    showOmicsTaskProgressCard(labRun.value, {
      failureReason: omicsFailureReason.value,
      failedTaskCount: omicsFailedTasks.value.length,
      hasProgress: !!omicsProgress.value?.progress,
    }),
  );
</script>

<template>
  <EGPageHeader
    :title="labRun?.RunName || ''"
    :show-back="true"
    :back-action="() => $router.push(labTab('Lab Runs'))"
    :is-loading="isLoading"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[{ label: 'Lab Runs', to: labTab('Lab Runs') }, labRun?.RunName || '']"
  >
    <template v-if="labRun" #titleSuffix>
      <EGStatusChip :status="labRun.Status" />
    </template>

    <UTooltip v-if="canRetry" :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
      <template #text>
        <p>
          Relaunch pre-filled from this run. Completed steps are reused where the sample data and their inputs are
          unchanged; changing the sample data re-runs from the start.
        </p>
      </template>
      <EGButton icon="i-heroicons-arrow-path" label="Retry run" size="sm" @click="retryRun" />
    </UTooltip>
  </EGPageHeader>

  <EGRunMetaLine v-if="labRun" :lab-run="labRun" class="mb-6 mt-2" />

  <EGDetailTabs
    :model-value="tabIndex"
    :items="tabItems"
    aria-label="Laboratory run sections"
    @update:model-value="handleTabChange"
  >
    <template #default="{ item }">
      <!-- Run Details -->
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <div v-if="labRun" class="grid items-start gap-3 lg:grid-cols-3">
          <div class="flex flex-col gap-3 lg:col-span-2">
            <div v-if="platformFailureReason || omicsFailedTasks.length" class="mb-6 space-y-3">
              <EGRunFailureReason
                v-if="platformFailureReason && labRun"
                :reason="platformFailureReason"
                :platform="labRun.Platform"
                :error-report="platformErrorReport"
              >
                <template v-if="failureClassificationVisible" #analysis>
                  <div class="mb-3 flex items-center gap-1.5">
                    <h4 class="text-muted text-xs font-medium uppercase tracking-wide">Failure analysis</h4>
                    <!-- Provenance: the summary below reads as authoritative prose, so state plainly that a
                         model wrote it, what it was given, and that it is a suggestion rather than a verdict. -->
                    <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                      <template #text>
                        <div class="space-y-1.5 py-1">
                          <p>
                            This attempts to explain the raw error above in plain language and suggests a next step. It
                            is generated automatically, not written by a person.
                          </p>
                          <p>
                            <span class="font-medium text-black">How it works</span>
                            — documented HealthOmics error codes are matched against a built-in lookup table, so those
                            results are always identical. Anything else is sent to the language model configured for
                            this lab.
                          </p>
                          <p>
                            <span class="font-medium text-black">What it is given</span>
                            — the platform, the workflow name and the error text the run returned. Never your sequence
                            data or run outputs.
                          </p>
                          <p class="italic">
                            Treat it as a starting point, not a verdict — check the raw error and the platform logs
                            before acting on it.
                          </p>
                        </div>
                      </template>
                      <UIcon
                        name="i-heroicons-information-circle"
                        class="text-muted h-4 w-4 shrink-0"
                        aria-label="How failure analysis works"
                      />
                    </UTooltip>
                  </div>
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-3">
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
                    <p v-if="ambiguousEvidenceNote" class="text-muted border-l-2 border-gray-200 pl-3 text-xs">
                      {{ ambiguousEvidenceNote }}
                    </p>
                    <EGAnalysisHistory :entries="labRun?.AnalysisHistory" :run-count="labRun?.AnalysisRunCount" />
                  </div>
                </template>

                <template v-if="canRequestAnalysis" #action>
                  <div class="flex flex-wrap items-center gap-2">
                    <EGButton
                      :label="analysisButtonLabel"
                      :loading="analysisInFlight"
                      :disabled="analysisInFlight"
                      variant="secondary"
                      size="xs"
                      @click="requestAnalysis"
                    />
                    <EGButton
                      v-if="analysisStalled"
                      label="Check again"
                      variant="secondary"
                      size="xs"
                      @click="checkAnalysisAgain"
                    />
                    <span v-if="analysisStalled" class="text-muted text-xs italic">
                      Still processing — this can take a few minutes.
                    </span>
                    <span v-else-if="analysisInFlight" class="text-muted text-xs italic">Analysing…</span>
                    <span v-else-if="labRun?.AnalysisStatus === 'Failed'" class="flex flex-col text-xs italic">
                      <span class="text-red-700">{{ analysisErrorMessage(labRun?.AnalysisErrorCode) }}</span>
                      <span v-if="labRun?.AnalysisErrorMessage" class="text-muted">
                        {{ toSentenceCase(labRun.AnalysisErrorMessage) }}
                      </span>
                    </span>
                  </div>
                </template>
              </EGRunFailureReason>

              <EGRunFailedTasks :tasks="omicsFailedTasks" />
            </div>

            <div v-if="showSeqeraProgressCard || showOmicsProgressCard" class="mb-6 space-y-3">
              <!-- Seqera task-level progress for FAILED or RUNNING runs -->
              <section
                v-if="showSeqeraProgressCard"
                class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
              >
                <h3 class="mb-4 text-sm font-medium text-black">Task Breakdown</h3>
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
                v-if="showOmicsProgressCard"
                class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
              >
                <h3 class="mb-4 text-sm font-medium text-black">
                  {{ labRun.Status === 'FAILED' ? 'Failed Tasks' : 'Task Progress' }}
                </h3>
                <div v-if="omicsProgress?.progress && !isTerminalRunStatus(labRun.Status)" class="mb-4">
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
              </section>
            </div>

            <section class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 pt-0 max-md:px-5">
              <h2 class="sr-only">Run details</h2>
              <h3 class="text-muted mt-6 text-xs font-medium uppercase tracking-wide">Configuration</h3>
              <dl class="mt-2 space-y-0">
                <div :class="rowStyle">
                  <dt :class="rowLabelStyle">Run Name</dt>
                  <dd :class="rowContentStyle">{{ labRun.RunName }}</dd>
                </div>

                <div v-if="labRun.Description" :class="rowStyle">
                  <dt :class="rowLabelStyle">Description</dt>
                  <dd :class="[rowContentStyle, 'whitespace-pre-wrap']">{{ labRun.Description }}</dd>
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
              </dl>

              <h3 class="text-muted mt-6 text-xs font-medium uppercase tracking-wide">Identifiers</h3>
              <dl class="mt-2 space-y-0">
                <div :class="rowStyle">
                  <dt :class="rowLabelStyle">Owner</dt>
                  <dd :class="rowContentStyle">{{ labRun.Owner }}</dd>
                </div>

                <div :class="rowStyle">
                  <dt :class="rowLabelStyle">Internal Run Id</dt>
                  <dd :class="rowContentStyle">
                    <span class="inline-flex items-center gap-1">
                      <span class="break-all font-mono text-xs">{{ labRun.RunId }}</span>
                      <EGCopyButton :value="labRun.RunId" label="Copy internal run ID" />
                    </span>
                  </dd>
                </div>

                <div v-if="labRun.ExternalRunId" :class="rowStyle">
                  <dt :class="rowLabelStyle">External Run Id</dt>
                  <dd :class="rowContentStyle">
                    <span class="inline-flex items-center gap-1">
                      <span class="break-all font-mono text-xs">{{ labRun.ExternalRunId }}</span>
                      <EGCopyButton :value="labRun.ExternalRunId" label="Copy external run ID" />
                    </span>
                  </dd>
                </div>

                <div :class="rowStyle" v-if="labRun.ModifiedAt">
                  <dt :class="rowLabelStyle">Last Modified</dt>
                  <dd :class="rowContentStyle">
                    {{ `${getTime(labRun.ModifiedAt)} ⋅ ${getDate(labRun.ModifiedAt)}` }}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div class="flex flex-col gap-3">
            <EGRunSummaryCard :lab-run="labRun" />
            <EGRunInputData :lab-run="labRun" :lab-id="labId" :lab-name="lab?.Name ?? ''" />
          </div>
        </div>
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
