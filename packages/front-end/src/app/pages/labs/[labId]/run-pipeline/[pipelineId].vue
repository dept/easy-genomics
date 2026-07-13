<script setup lang="ts">
  import { toCountBucket, toSizeBucket } from '@easy-genomics/shared-lib/src/app/utils/analytics-buckets';
  import { useRunStore } from '@FE/stores';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { v4 as uuidv4 } from 'uuid';
  import {
    DescribePipelineSchemaResponse,
    Pipeline as SeqeraPipeline,
  } from '@/packages/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import { ensureLabInActiveOrg } from '@FE/utils/ensure-lab-in-active-org';

  const { $api } = useNuxtApp();
  const $router = useRouter();
  const $route = useRoute();

  const runStore = useRunStore();
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const labsStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();

  const labId = $route.params.labId as string;
  const pipelineId = $route.params.pipelineId as string;

  // check permissions to be on this page
  if (!userStore.canViewLab(labId)) {
    $router.push('/labs');
  }

  onBeforeMount(async () => {
    if (await ensureLabInActiveOrg({ labId })) {
      return;
    }
  });

  // set a new seqeraRunTempId if not provided
  if (!$route.query.seqeraRunTempId) {
    $router.push({ query: { seqeraRunTempId: uuidv4() } });
  }

  const labName = computed<string>(() => labsStore.labs[labId].Name);

  usePageTitle(() => (pipeline.value?.name ? `Run pipeline — ${pipeline.value.name}` : 'Run pipeline'));

  const seqeraRunTempId = computed<string>(() => $route.query.seqeraRunTempId as string);

  const wipSeqeraRun = computed<WipRun | undefined>(() => runStore.wipSeqeraRuns[seqeraRunTempId.value]);

  /** Only mount the active wizard step panel content (see run-workflow page). */
  const activeStepKey = computed(() => steps.value[selectedStepIndex.value]?.key);

  const pipeline = computed<SeqeraPipeline | null>(() => seqeraPipelinesStore.pipelines[pipelineId] || null);

  const hasLaunched = ref<boolean>(false);
  const exitConfirmed = ref<boolean>(false);
  const nextRoute = ref<string | null>(null);

  const schema = ref({});
  const initialParams = ref({});

  const selectedStepIndex = ref(0);
  const steps = ref([
    { disabled: false, key: 'details', label: 'Run Details' },
    { disabled: true, key: 'upload', label: 'Upload Data' },
    { disabled: true, key: 'parameters', label: 'Edit Parameters' },
    { disabled: true, key: 'review', label: 'Review Pipeline' },
  ]);

  watch(
    seqeraRunTempId,
    async (tempId) => {
      if (tempId) await initialize();
    },
    { immediate: true },
  );

  watch(
    () => wipSeqeraRun.value?.files,
    (newFiles, oldFiles) => {
      if (!!oldFiles?.length && newFiles?.length === 0) {
        resetParams();
      }
    },
    { deep: true },
  );

  /**
   * Intercept any navigation away from the page (including the browser back button) and present the modal
   */
  onMounted(() => {
    // Analytics: run wizard started.
    useAnalytics().track('run_wizard_started', { platform: 'seqera' });
  });

  onBeforeRouteLeave((to, from, next) => {
    const noConfirmRoutes = ['/signin'];

    if (noConfirmRoutes.some((route) => to.path.startsWith(route))) {
      next(true);
      return;
    }

    if (hasLaunched.value) {
      // if the pipeline has launched no need to confirm cancel
      next(true);
    } else if (!nextRoute.value) {
      // if there's currently no nextRoute, don't navigate yet and show the confirm cancel dialog
      nextRoute.value = to.path;
      next(false);
    } else if (!exitConfirmed.value) {
      // don't go if exit hasn't been confirmed
      next(false);
    } else {
      // go if exit confirmed
      next(true);
    }
  });

  /**
   * Reads the pipeline details, schema, and parameters from the API and initializes the pipeline run store
   */
  async function initialize() {
    uiStore.setRequestPending('loadSeqeraPipeline');

    // reset state refs
    hasLaunched.value = false;
    selectedStepIndex.value = 0;

    schema.value = {};
    initialParams.value = {};

    steps.value.forEach((step) => (step.disabled = true));
    steps.value[0].disabled = false;

    // get pipeline schema from API
    const pipelineSchemaResponse: DescribePipelineSchemaResponse = await $api.seqeraPipelines.readPipelineSchema(
      parseInt(pipelineId),
      labId,
    );
    const originalSchema = JSON.parse(pipelineSchemaResponse.schema);

    const definitions = originalSchema.$defs || originalSchema.definitions;

    // Filter Schema to exclude any sections that do not have any visible parameters for user input
    const filteredDefinitions = Object.keys(definitions)
      .flatMap((key) => {
        const section = definitions[key];
        const hasAllHiddenSettings: boolean = Object.values(section.properties).every((x) => x?.hidden === true);
        if (!hasAllHiddenSettings) {
          return {
            [key]: section,
          };
        }
      })
      .filter((_) => _)
      .reduce((acc, cur) => ({ ...acc, [Object.keys(cur)[0]]: Object.values(cur)[0] }), {});

    // Identify Seqera pipeline schema required parameters
    const paramsRequired: string[] = definitions.input_output_options.required
      ? definitions.input_output_options.required
      : [];

    schema.value = {
      ...originalSchema,
      $defs: filteredDefinitions,
    };

    // create an object with all non-hidden fields' default values
    function defaultVal(type: 'string' | 'number' | 'boolean'): '' | 0 | false {
      switch (type) {
        case 'string':
          return '';
        case 'number':
          return 0;
        case 'boolean':
          return false;
      }
    }
    const schemaDefaults: any = {};
    for (const sectionKey of Object.keys(filteredDefinitions)) {
      const section: any = filteredDefinitions[sectionKey];
      for (const propertyKey of Object.keys(section.properties)) {
        const property: any = section.properties[propertyKey];
        schemaDefaults[propertyKey] = defaultVal(property.type);
      }
    }

    // initialize wip run with values
    runStore.updateWipSeqeraRun(seqeraRunTempId.value, {
      transactionId: seqeraRunTempId.value,
      paramsRequired: paramsRequired,
    });

    const existingWip = runStore.wipSeqeraRuns[seqeraRunTempId.value];

    // initialize params and save so that they can be easily reset
    initialParams.value = {
      ...schemaDefaults, // default values for all non-hidden fields
      ...JSON.parse(pipelineSchemaResponse.params!), // overwrite with values from the pipeline schema
      input: '', // clear the default sample sheet github link that comes from the pipeline itself
    };

    const paramsToApply = JSON.parse(JSON.stringify(initialParams.value));
    if (existingWip?.sampleSheetS3Url && existingWip?.params?.input) {
      paramsToApply.input = existingWip.params.input;
      paramsToApply.outdir = existingWip.params.outdir;
    }

    runStore.updateWipSeqeraRunParams(seqeraRunTempId.value, paramsToApply);

    applySequenceCollectionsPrepopulation();

    uiStore.setRequestComplete('loadSeqeraPipeline');
  }

  /** When opened from Data Collections with a pre-built sample sheet, skip to parameter configuration. */
  function applySequenceCollectionsPrepopulation(): void {
    if ($route.query.from !== 'data-collections') return;

    const wip = runStore.wipSeqeraRuns[seqeraRunTempId.value];
    if (!wip?.sampleSheetS3Url || !wip?.runName) return;

    setStepEnabled('upload', true);
    setStepEnabled('parameters', true);
    const parametersIndex = steps.value.findIndex((step) => step.key === 'parameters');
    if (parametersIndex >= 0) {
      selectedStepIndex.value = parametersIndex;
    }
  }

  function resetParams() {
    runStore.updateWipSeqeraRun(seqeraRunTempId.value, { params: JSON.parse(JSON.stringify(initialParams.value)) });
  }

  function confirmCancel() {
    // Analytics: run wizard abandoned (only if not launched).
    if (!hasLaunched.value) {
      useAnalytics().track('run_wizard_abandoned', {
        step_at_exit: steps.value[selectedStepIndex.value]?.key || '',
        platform: 'seqera',
      });
    }
    exitConfirmed.value = true;
    $router.push(nextRoute.value!);
  }

  /**
   * Resets the pipeline run:
   * - clears some store values
   * - re-initializes the schema + prefills params
   * - re-mounts the stepper to reset it to initial state
   */
  function resetRunPipeline() {
    $router.push({ query: { seqeraRunTempId: uuidv4() } });
  }

  /**
   * Set the enabled state of a step in the stepper
   * @param step
   * @param isEnabled
   */
  function setStepEnabled(stepKey: string, isEnabled: boolean) {
    const stepIndex = steps.value.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) throw new Error(`no step found with key "${stepKey}"`);

    if (isEnabled) {
      steps.value[stepIndex].disabled = false;
    } else {
      // If the step is disabled, disable all subsequent steps
      disableStepsFrom(stepIndex);
    }
  }

  /**
   * Disable all steps from the given index
   * @param index
   */
  function disableStepsFrom(index: number) {
    for (let i = index; i < steps.value.length; i++) {
      steps.value[i].disabled = true;
    }
  }

  function nextStep(val: string) {
    const completedStep = steps.value[selectedStepIndex.value]?.key || '';
    setStepEnabled(val, true);
    selectedStepIndex.value = clampIndex(selectedStepIndex.value + 1);

    // Analytics: run wizard step completed.
    useAnalytics().track('run_step_completed', { step: completedStep, platform: 'seqera' });
  }

  function clampIndex(index: number) {
    return Math.min(steps.value.length - 1, Math.max(0, index));
  }

  function previousStep() {
    selectedStepIndex.value = clampIndex(selectedStepIndex.value - 1);
  }

  function disableAllSteps() {
    steps.value.forEach((step) => (step.disabled = true));
  }

  function enableAllSteps() {
    steps.value.forEach((step) => (step.disabled = false));
  }

  function handleSubmitLaunchRequest() {
    disableAllSteps();
  }

  function handleSubmitLaunchRequestError() {
    enableAllSteps();
  }

  async function handleLaunchSuccess() {
    hasLaunched.value = true;
    selectedStepIndex.value = -1;

    // Analytics: run launched (workflow id hashed; counts/sizes bucketed).
    const analytics = useAnalytics();
    const workflowIdHash = await analytics.hashId(pipelineId);
    const wip = wipSeqeraRun.value as { uploadedFiles?: unknown[]; uploadedFileSize?: number } | undefined;
    const fileCount = Array.isArray(wip?.uploadedFiles) ? wip!.uploadedFiles.length : 0;
    const uploadBytes = typeof wip?.uploadedFileSize === 'number' ? wip!.uploadedFileSize : 0;
    analytics.track('run_launched', {
      platform: 'seqera',
      workflow_id_hash: workflowIdHash,
      file_count_bucket: toCountBucket(fileCount),
      upload_size_bucket: toSizeBucket(uploadBytes),
    });
  }
</script>

<template>
  <EGPageHeader
    title="Run Pipeline"
    :description="labName"
    :show-back="!hasLaunched"
    :back-action="() => (nextRoute = `/labs/${labId}?tab=Seqera+Pipelines`)"
    back-button-label="Exit Run"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[pipeline?.name]"
  />

  <template v-if="uiStore.isRequestPending('loadSeqeraPipeline') || !seqeraRunTempId">
    <EGLoadingSpinner label="Loading pipeline" />
  </template>

  <template v-else>
    <EGWizardStepTabs
      v-model="selectedStepIndex"
      :items="steps"
      :has-launched="hasLaunched"
      aria-label="Run Seqera pipeline steps"
    >
      <template #panel="{ selected }">
        <div v-if="!hasLaunched">
          <EGRunFormRunDetails
            v-if="activeStepKey === 'details' && selected"
            platform="Seqera Cloud"
            :wip-run-temp-id="seqeraRunTempId"
            :pipeline-or-workflow-name="pipeline?.name"
            :pipeline-or-workflow-description="pipeline?.description || ''"
            @next-step="() => nextStep('upload')"
            @step-validated="($event) => setStepEnabled('upload', $event)"
          />

          <EGRunFormUploadData
            v-else-if="activeStepKey === 'upload' && selected"
            :lab-id="labId"
            :pipeline-or-workflow-name="pipeline.name"
            platform="Seqera Cloud"
            :wip-run-temp-id="seqeraRunTempId"
            @next-step="() => nextStep('parameters')"
            @previous-step="() => previousStep()"
            @step-validated="($event) => setStepEnabled('parameters', $event)"
          />

          <EGRunPipelineFormEditParameters
            v-else-if="activeStepKey === 'parameters' && selected"
            :params="wipSeqeraRun?.params"
            :schema="schema"
            :lab-id="labId"
            :pipeline-id="pipelineId"
            :seqera-run-temp-id="seqeraRunTempId"
            @next-step="() => nextStep('review')"
            @previous-step="() => previousStep()"
          />

          <EGRunPipelineFormReview
            v-else-if="activeStepKey === 'review' && selected"
            :schema="schema"
            :params="wipSeqeraRun?.params"
            :lab-id="labId"
            :pipeline-id="pipelineId"
            :seqera-run-temp-id="seqeraRunTempId"
            @submit-launch-request="() => handleSubmitLaunchRequest()"
            @submit-launch-request-error="() => handleSubmitLaunchRequestError()"
            @has-launched="() => handleLaunchSuccess()"
            @previous-tab="() => previousStep()"
          />
        </div>
      </template>
    </EGWizardStepTabs>
  </template>

  <!-- post-launch rendering -->
  <template v-if="hasLaunched">
    <EGEmptyDataCTA
      message="Your Workflow Run has Launched! Check on your progress via Runs."
      :primary-button-action="() => $router.push(`/labs/${labId}?tab=Lab+Runs`)"
      primary-button-label="Back to Runs"
      :secondary-button-action="() => resetRunPipeline()"
      secondary-button-label="Launch Another Workflow Run"
      img-src="/images/empty-state-launched.jpg"
    />
  </template>

  <EGDialog
    action-label="Cancel Pipeline Run"
    :action-variant="ButtonVariantEnum.enum.destructive"
    @action-triggered="confirmCancel"
    primary-message="Are you sure you would like to cancel?"
    secondary-message="Any changes made or files uploaded will not be saved."
    :model-value="!!nextRoute"
    @update:modelValue="nextRoute = null"
  />
</template>
