<script setup lang="ts">
  import { useRunStore } from '@FE/stores';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { v4 as uuidv4 } from 'uuid';
  import {
    DescribePipelineSchemaResponse,
    Pipeline as SeqeraPipeline,
  } from '@/packages/shared-lib/src/app/types/nf-tower/nextflow-tower-api';

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

  // set a new seqeraRunTempId if not provided
  if (!$route.query.seqeraRunTempId) {
    $router.push({ query: { seqeraRunTempId: uuidv4() } });
  }

  const labName = computed<string>(() => labsStore.labs[labId].Name);

  const seqeraRunTempId = computed<string>(() => $route.query.seqeraRunTempId as string);

  const wipSeqeraRun = computed<WipRun | undefined>(() => runStore.wipSeqeraRuns[seqeraRunTempId.value]);

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

    // initialize params and save so that they can be easily reset
    initialParams.value = {
      ...schemaDefaults, // default values for all non-hidden fields
      ...JSON.parse(pipelineSchemaResponse.params!), // overwrite with values from the pipeline schema
      input: '', // clear the default sample sheet github link that comes from the pipeline itself
    };

    runStore.updateWipSeqeraRunParams(
      seqeraRunTempId.value,
      // make a copy of initialParams to ensure the original doesn't get changed
      JSON.parse(JSON.stringify(initialParams.value)),
    );

    uiStore.setRequestComplete('loadSeqeraPipeline');
  }

  function resetParams() {
    runStore.updateWipSeqeraRun(seqeraRunTempId.value, { params: JSON.parse(JSON.stringify(initialParams.value)) });
  }

  function confirmCancel() {
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
    setStepEnabled(val, true);
    selectedStepIndex.value = clampIndex(selectedStepIndex.value + 1);
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

  function handleLaunchSuccess() {
    hasLaunched.value = true;
    selectedStepIndex.value = -1;
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
    <EGLoadingSpinner />
  </template>

  <template v-else>
    <UTabs :items="steps" :ui="EGTabsStyles" v-model="selectedStepIndex" :key="selectedStepIndex">
      <!-- tab rendering -->
      <template #default="{ item, index, selected }">
        <div class="relative flex items-center gap-2 truncate">
          <UIcon
            v-if="selectedStepIndex > index || hasLaunched"
            name="i-heroicons-check-20-solid"
            class="text-primary h-4 w-4 flex-shrink-0"
          />
          <span :class="selectedStepIndex > index || hasLaunched ? 'text-primary' : ''">{{ item.label }}</span>
          <span v-if="selected" class="bg-primary-500 dark:bg-primary-400 absolute -right-4 h-2 w-2 rounded-full" />
        </div>
      </template>

      <!-- step rendering -->
      <template #item="{ item, index }">
        <div v-if="!hasLaunched">
          <!-- Run Details -->
          <template v-if="steps[selectedStepIndex].key === 'details'">
            <EGRunFormRunDetails
              platform="Seqera Cloud"
              :wip-run-temp-id="seqeraRunTempId"
              :pipeline-or-workflow-name="pipeline?.name"
              :pipeline-or-workflow-description="pipeline?.description || ''"
              @next-step="() => nextStep('upload')"
              @step-validated="($event) => setStepEnabled('upload', $event)"
            />
          </template>

          <!-- Upload Data -->
          <template v-if="steps[selectedStepIndex].key === 'upload'">
            <EGRunFormUploadData
              :lab-id="labId"
              :pipeline-or-workflow-name="pipeline.name"
              platform="Seqera Cloud"
              :wip-run-temp-id="seqeraRunTempId"
              @next-step="() => nextStep('parameters')"
              @previous-step="() => previousStep()"
              @step-validated="($event) => setStepEnabled('parameters', $event)"
            />
          </template>

          <!-- Edit Parameters -->
          <template v-if="steps[selectedStepIndex].key === 'parameters'">
            <EGRunPipelineFormEditParameters
              :params="wipSeqeraRun?.params"
              :schema="schema"
              :lab-id="labId"
              :pipeline-id="pipelineId"
              :seqera-run-temp-id="seqeraRunTempId"
              @next-step="() => nextStep('review')"
              @previous-step="() => previousStep()"
            />
          </template>

          <!-- Review Pipeline -->
          <template v-if="steps[selectedStepIndex].key === 'review'">
            <EGRunPipelineFormReview
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
          </template>
        </div>
      </template>
    </UTabs>
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
