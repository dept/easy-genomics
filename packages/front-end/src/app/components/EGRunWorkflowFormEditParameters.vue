<script setup lang="ts">
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import { useToastStore } from '@FE/stores';

  const props = defineProps<{
    schema: object;
    params: object;
    labId: string;
    workflowId: string;
    omicsRunTempId: string;
  }>();

  const emit = defineEmits(['next-step', 'previous-step', 'step-validated']);

  const runStore = useRunStore();
  const labsStore = useLabsStore();
  const omicsWorklowsStore = useOmicsWorkflowsStore();
  const uiStore = useUiStore();

  const wipOmicsRun = computed<WipRun | undefined>(() => runStore.wipOmicsRuns[props.omicsRunTempId]);

  const labName = computed<string | null>(() => labsStore.labs[props.labId]?.Name || null);
  const workflowName = computed<string | null>(() => omicsWorklowsStore.workflows[props.workflowId]?.name || null);

  type SchemaItem = {
    name: string;
    description: string;
    optional: boolean;
  };

  const orderedSchema = computed<SchemaItem[]>(() =>
    Object.keys(props.schema)
      .map((fieldName) => ({
        name: fieldName,
        ...props.schema[fieldName],
      }))
      .sort((fieldA, fieldB) => {
        // list mandatory fields first
        if (fieldA.optional !== true && fieldB.optional === true) return -1;
        if (fieldA.optional === true && fieldB.optional !== true) return 1;

        return 0;
      }),
  );

  // all schema fields with empty string as default
  const paramDefaults: { [key: string]: '' } = Object.fromEntries(
    Object.keys(props.schema).map((fieldName) => [fieldName, '']),
  );

  const localProps = reactive({
    schema: props.schema,
    params: {
      // initialize all fields with empty string as default
      ...paramDefaults,
      // overwrite with any existing values
      ...props.params,
    },
  });

  // Auto-populate runname/run_name parameter with the run name from Run Details
  function autoPopulateRunName() {
    const runName = wipOmicsRun.value?.runName;
    if (runName && localProps.params) {
      // Check for both 'runname' and 'run_name' parameters
      if ('runname' in localProps.params && !localProps.params['runname']) {
        localProps.params['runname'] = runName;
      }
      if ('run_name' in localProps.params && !localProps.params['run_name']) {
        localProps.params['run_name'] = runName;
      }
    }
  }

  // Auto-populate when component mounts
  onMounted(() => {
    autoPopulateRunName();
  });

  // Watch for changes in run name and auto-populate if needed
  watch(
    () => wipOmicsRun.value?.runName,
    (newRunName) => {
      if (newRunName) {
        autoPopulateRunName();
      }
    },
  );

  // save the updated parameters to the store too
  runStore.updateWipOmicsRunParams(props.omicsRunTempId, localProps.params);

  function onSubmit() {
    const paramsRequired = wipOmicsRun.value?.paramsRequired || [];
    const missingParams = paramsRequired.filter((paramName: string) => !wipOmicsRun.value?.params[paramName]);

    if (missingParams.length > 0) {
      useToastStore().error(`The '${missingParams.shift()}' field is required. Please try again.`);
    } else {
      emit('next-step');
    }
  }

  watch(
    // watches for input changes in the local params object and updates the store with the new value
    () => localProps.params,
    (val) => {
      if (val) runStore.updateWipOmicsRunParams(props.omicsRunTempId, val);
    },
    { deep: true },
  );
</script>

<template>
  <EGS3SampleSheetBar
    v-if="wipOmicsRun?.sampleSheetS3Url || uiStore.isRequestPending('generateSampleSheet')"
    :url="wipOmicsRun.sampleSheetS3Url"
    :lab-id="props.labId"
    :lab-name="labName"
    :pipeline-or-workflow-name="workflowName"
    platform="AWS HealthOmics"
    :run-name="wipOmicsRun.runName"
    :display-label="true"
  />

  <div class="flex">
    <div class="mr-4 w-1/4">
      <EGCard>
        <EGText tag="small" class="mb-4">Step 03</EGText>
        <EGText tag="h4" class="mb-0">Edit Parameters</EGText>
      </EGCard>
    </div>
    <div class="w-3/4">
      <EGCard>
        <div v-for="schemaField in orderedSchema" class="mb-6">
          <EGFormGroup
            :label="schemaField.name"
            :name="schemaField.name"
            :required="wipOmicsRun.paramsRequired.includes(schemaField.name)"
          >
            <EGParametersStringField
              :description="schemaField.description"
              v-model="localProps.params[schemaField.name]"
            />
          </EGFormGroup>
        </div>
      </EGCard>

      <div class="mt-6 flex justify-between">
        <EGButton
          :size="ButtonSizeEnum.enum.sm"
          variant="secondary"
          label="Previous step"
          @click="emit('previous-step')"
        />
        <EGButton :size="ButtonSizeEnum.enum.sm" type="submit" label="Save & Continue" @click="onSubmit" />
      </div>
    </div>
  </div>
</template>
