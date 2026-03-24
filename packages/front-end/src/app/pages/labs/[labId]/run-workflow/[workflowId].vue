<script setup lang="ts">
  import { ReadWorkflow } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
  import { useRunStore } from '@FE/stores';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { WorkflowParameter } from '@aws-sdk/client-omics';
  import { v4 as uuidv4 } from 'uuid';

  const { $api } = useNuxtApp();
  const $router = useRouter();
  const $route = useRoute();

  const runStore = useRunStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();
  const uiStore = useUiStore();
  const userStore = useUserStore();
  const labsStore = useLabsStore();

  const labId = $route.params.labId as string;
  const workflowId = $route.params.workflowId as string;

  // check permissions to be on this page
  if (!userStore.canViewLab(labId)) {
    $router.push('/labs');
  }

  // set a new omicsRunTempId if not provided
  if (!$route.query.omicsRunTempId) {
    $router.push({ query: { omicsRunTempId: uuidv4() } });
  }

  const hasLaunched = ref<boolean>(false);
  const exitConfirmed = ref<boolean>(false);
  const nextRoute = ref<string | null>(null);

  const selectedStepIndex = ref(0);
  const steps = ref([
    { disabled: false, key: 'details', label: 'Run Details' },
    { disabled: true, key: 'upload', label: 'Upload Data' },
    { disabled: true, key: 'parameters', label: 'Edit Parameters' },
    { disabled: true, key: 'review', label: 'Review Pipeline' },
  ]);

  const labName = computed<string>(() => labsStore.labs[labId].Name);

  /** Must match EGRunFormRunDetails default sentinel for Omics workflow version */
  const OMICS_DEFAULT_WORKFLOW_VERSION = '__omics_default_version__';

  const omicsRunTempId = computed<string>(() => $route.query.omicsRunTempId as string);

  const workflowVersionOptions = ref<{ value: string; label: string }[] | undefined>(undefined);

  const wipOmicsRun = computed<WipRun | null>(() => runStore.wipOmicsRuns[omicsRunTempId.value] || null);

  const workflow = computed<ReadWorkflow | null>(() => omicsWorkflowsStore.workflows[workflowId] || null);

  const schema = computed<Record<string, WorkflowParameter> | null>(() => workflow.value?.parameterTemplate ?? null);

  watch(
    omicsRunTempId,
    async (tempId) => {
      if (tempId) await initialize();
    },
    { immediate: true },
  );

  watch(
    () => wipOmicsRun.value?.files,
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

  function confirmCancel() {
    exitConfirmed.value = true;
    $router.push(nextRoute.value!);
  }

  /**
   * Reads the workflow details, schema, and parameters from the API and initializes the pipeline run store
   */
  async function initialize() {
    uiStore.setRequestPending('loadOmicsWorkflow');

    // reset state refs
    hasLaunched.value = false;
    selectedStepIndex.value = 0;

    steps.value.forEach((step) => (step.disabled = true));
    steps.value[0].disabled = false;

    // get full workflow details from API and save them in the store
    const omicsWorkflow: ReadWorkflow = await $api.omicsWorkflows.get(labId, workflowId);
    omicsWorkflowsStore.workflows[workflowId] = omicsWorkflow;

    try {
      const versionsRes = await $api.omicsWorkflows.listVersions(labId, workflowId);
      const names = (versionsRes.items ?? [])
        .map((v) => v.versionName)
        .filter((n): n is string => !!n)
        .sort((a, b) => a.localeCompare(b));
      if (names.length > 0) {
        workflowVersionOptions.value = [
          { value: OMICS_DEFAULT_WORKFLOW_VERSION, label: 'Default version' },
          ...names.map((n) => ({ value: n, label: n })),
        ];
      } else {
        workflowVersionOptions.value = undefined;
      }
    } catch {
      workflowVersionOptions.value = undefined;
    }

    // Identify AWS HealthOmics workflow schema required parameters
    const paramsRequired: string[] = Object.entries(omicsWorkflow.parameterTemplate)
      .map((param: [string, object]) => {
        const paramName: string = param[0];
        const paramDetails: any = param[1];

        if (paramDetails.optional === false) {
          return paramName;
        }
      })
      .filter((_) => _ != undefined);

    // initialize wip run in store
    runStore.updateWipOmicsRun(omicsRunTempId.value, {
      transactionId: omicsRunTempId.value,
      paramsRequired: paramsRequired,
    });
    // unlike seqera runs, omics runs don't have default values for parameters
    runStore.updateWipOmicsRunParams(omicsRunTempId.value, {});

    uiStore.setRequestComplete('loadOmicsWorkflow');
  }

  function resetParams() {
    runStore.updateWipOmicsRun(omicsRunTempId.value, { params: {} });
  }

  /**
   * Resets the pipeline run:
   * - clears some store values
   * - re-initializes the schema + prefills params
   * - re-mounts the stepper to reset it to initial state
   */
  function resetRunPipeline() {
    $router.push({ query: { omicsRunTempId: uuidv4() } });
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
    title="Run Workflow"
    :description="labName"
    :show-back="!hasLaunched"
    :back-action="() => (nextRoute = `/labs/${labId}?tab=HealthOmics+Workflows`)"
    back-button-label="Exit Run"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[workflow?.name]"
  />

  <template v-if="uiStore.isRequestPending('loadOmicsWorkflow') || !omicsRunTempId">
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
              platform="AWS HealthOmics"
              :wip-run-temp-id="omicsRunTempId"
              :pipeline-or-workflow-name="workflow?.name"
              :pipeline-or-workflow-description="workflow?.description || ''"
              :workflow-version-options="workflowVersionOptions"
              @next-step="() => nextStep('upload')"
              @step-validated="($event) => setStepEnabled('upload', $event)"
            />
          </template>

          <!-- Upload Data -->
          <template v-if="steps[selectedStepIndex].key === 'upload'">
            <EGRunFormUploadData
              :lab-id="labId"
              :pipeline-or-workflow-name="workflow.name"
              platform="AWS HealthOmics"
              :wip-run-temp-id="omicsRunTempId"
              @next-step="() => nextStep('parameters')"
              @previous-step="() => previousStep()"
              @step-validated="($event) => setStepEnabled('parameters', $event)"
            />
          </template>

          <!-- Edit Parameters -->
          <template v-if="steps[selectedStepIndex].key === 'parameters'">
            <EGRunWorkflowFormEditParameters
              :params="wipOmicsRun?.params"
              :schema="schema"
              :lab-id="labId"
              :workflow-id="workflowId"
              :omics-run-temp-id="omicsRunTempId"
              @next-step="() => nextStep('review')"
              @previous-step="() => previousStep()"
            />
          </template>

          <!-- Review Pipeline -->
          <template v-if="steps[selectedStepIndex].key === 'review'">
            <EGRunWorkflowFormReview
              :schema="schema"
              :params="wipOmicsRun?.params"
              :lab-id="labId"
              :omics-run-temp-id="omicsRunTempId"
              :s3-bucket="wipOmicsRun?.s3Bucket"
              :s3-path="wipOmicsRun?.s3Path"
              :run-name="wipOmicsRun?.runName"
              :transaction-id="wipOmicsRun?.transactionId"
              :workflow-id="workflowId"
              :workflow-name="workflow.name"
              :workflow-version-name="wipOmicsRun?.workflowVersionName"
              @submit-launch-request="() => handleSubmitLaunchRequest()"
              @submit-launch-request-error="() => handleSubmitLaunchRequestError()"
              @has-launched="() => handleLaunchSuccess()"
              @previous-tab="() => previousStep()"
            />
          </template>
        </div>
      </template>
    </UTabs>

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
      action-label="Cancel Workflow Run"
      :action-variant="ButtonVariantEnum.enum.destructive"
      @action-triggered="confirmCancel"
      primary-message="Are you sure you would like to cancel?"
      secondary-message="Any changes made or files uploaded will not be saved."
      :model-value="!!nextRoute"
      @update:modelValue="nextRoute = null"
    />
  </template>
</template>
