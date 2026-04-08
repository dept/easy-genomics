<script setup lang="ts">
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import { useToastStore } from '@FE/stores';

  const props = defineProps<{
    schema: object;
    params: object;
    labId: string;
    workflowId: string;
    omicsRunTempId: string;
    nfSchema?: object | null;
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
    // Enriched from nf-core JSON Schema
    type?: string;
    default?: string | boolean | number;
    enum?: string[];
    helpText?: string;
    hidden?: boolean;
  };

  /**
   * Build a flat lookup of all parameter definitions from the nf-core JSON Schema.
   * The schema groups parameters into `definitions` sections, each with `properties`.
   */
  const nfSchemaDefMap = computed<Record<string, any>>(() => {
    const schema = props.nfSchema as any;
    const defs = schema?.definitions ?? schema?.$defs;
    if (!defs) return {};

    const map: Record<string, any> = {};
    for (const section of Object.values(defs) as any[]) {
      if (section.properties) {
        for (const [name, def] of Object.entries(section.properties)) {
          map[name] = def;
        }
      }
    }
    return map;
  });

  const orderedSchema = computed<SchemaItem[]>(() =>
    Object.keys(props.schema)
      .map((fieldName) => {
        const paramDef = nfSchemaDefMap.value[fieldName] || {};
        return {
          name: fieldName,
          ...(props.schema as any)[fieldName], // description + optional from parameterTemplate
          type: paramDef.type,
          default: paramDef.default,
          enum: paramDef.enum,
          helpText: paramDef.help_text,
          hidden: paramDef.hidden,
        } as SchemaItem;
      })
      .filter((field) => !field.hidden)
      .sort((fieldA, fieldB) => {
        // Required fields first
        if (fieldA.optional !== true && fieldB.optional === true) return -1;
        if (fieldA.optional === true && fieldB.optional !== true) return 1;
        return 0;
      }),
  );

  /**
   * Default values for each parameter:
   * 1. Schema default (from nf-core JSON Schema) when available
   * 2. Empty string / false for boolean
   * User-saved defaults in `props.params` overlay these below.
   */
  const paramDefaults = computed<Record<string, string | boolean | number>>(() =>
    Object.fromEntries(
      Object.keys(props.schema).map((fieldName) => {
        const paramDef = nfSchemaDefMap.value[fieldName];
        if (paramDef?.default !== undefined) {
          return [fieldName, paramDef.default];
        }
        return [fieldName, paramDef?.type === 'boolean' ? false : ''];
      }),
    ),
  );

  const localProps = reactive({
    schema: props.schema,
    params: {
      // Initialize with schema defaults (or empty)
      ...paramDefaults.value,
      // Overlay with any user-saved or already-set values
      ...props.params,
    },
  });

  const shouldSaveAsDefaults = ref(false);

  // Auto-populate runname/run_name parameter with the run name from Run Details
  function autoPopulateRunName() {
    const runName = wipOmicsRun.value?.runName;
    if (runName && localProps.params) {
      if ('runname' in localProps.params && !localProps.params['runname']) {
        localProps.params['runname'] = runName;
      }
      if ('run_name' in localProps.params && !localProps.params['run_name']) {
        localProps.params['run_name'] = runName;
      }
    }
  }

  onMounted(() => {
    autoPopulateRunName();
  });

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

  function getPersistableDefaultParams(params: Record<string, unknown>): Record<string, unknown> {
    const ignoredFields = new Set(['input', 'output', 'outdir']);
    const entries = Object.entries(params).filter(([key, value]) => !ignoredFields.has(key) && !!value);
    return Object.fromEntries(entries);
  }

  async function saveDefaultsForWorkflow() {
    try {
      const { $api } = useNuxtApp();
      const userStore = useUserStore();
      const userId = userStore.currentUserDetails.id;
      if (!userId) {
        return false;
      }

      const user = await $api.users.getUser();
      const existingDefaults = user.OmicsWorkflowDefaultParams || {};
      const workflowDefaults = getPersistableDefaultParams(localProps.params as Record<string, unknown>);

      await $api.users.updateUser(userId, {
        OmicsWorkflowDefaultParams: {
          ...existingDefaults,
          [props.workflowId]: workflowDefaults,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to save workflow defaults', error);
      useToastStore().error('Unable to save workflow defaults. You can continue without saving.');
      return false;
    }
  }

  async function onSubmit() {
    const paramsRequired = wipOmicsRun.value?.paramsRequired || [];
    const missingParams = paramsRequired.filter((paramName: string) => !wipOmicsRun.value?.params[paramName]);

    if (missingParams.length > 0) {
      useToastStore().error(`The '${missingParams.shift()}' field is required. Please try again.`);
    } else {
      try {
        const userStore = useUserStore();
        const userId = userStore.currentUserDetails.id;
        if (!userId) {
          emit('next-step');
          return;
        }

        if (shouldSaveAsDefaults.value) {
          const success = await saveDefaultsForWorkflow();
          if (success) {
            useToastStore().success('Saved defaults for this workflow.');
          }
        }
        emit('next-step');
      } catch (error) {
        console.error('Failed to check workflow defaults', error);
        emit('next-step');
      }
    }
  }

  watch(
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
        <div v-for="schemaField in orderedSchema" :key="schemaField.name" class="mb-6">
          <EGFormGroup
            :label="schemaField.name"
            :name="schemaField.name"
            :required="wipOmicsRun.paramsRequired.includes(schemaField.name)"
          >
            <!-- Boolean: toggle -->
            <EGParametersBooleanField
              v-if="schemaField.type === 'boolean'"
              :description="schemaField.description"
              :help-text="schemaField.helpText"
              :model-value="!!localProps.params[schemaField.name]"
              @update:model-value="(val) => (localProps.params[schemaField.name] = val)"
            />
            <!-- Integer / number: numeric input -->
            <EGParametersNumberField
              v-else-if="schemaField.type === 'integer' || schemaField.type === 'number'"
              :description="schemaField.description"
              :help-text="schemaField.helpText"
              :model-value="Number(localProps.params[schemaField.name]) || 0"
              @update:model-value="(val) => (localProps.params[schemaField.name] = val)"
            />
            <!-- Enum: searchable select -->
            <EGParametersSelectField
              v-else-if="schemaField.enum?.length"
              :description="schemaField.description"
              :help-text="schemaField.helpText"
              :options="schemaField.enum"
              :model-value="String(localProps.params[schemaField.name] ?? '')"
              @update:model-value="(val) => (localProps.params[schemaField.name] = val)"
            />
            <!-- Default: text input -->
            <EGParametersStringField
              v-else
              :description="schemaField.description"
              :help-text="schemaField.helpText"
              v-model="localProps.params[schemaField.name]"
            />
          </EGFormGroup>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="save-defaults-checkbox"
            type="checkbox"
            class="text-primary focus:ring-primary h-4 w-4 rounded border-gray-300 focus:ring-2"
            v-model="shouldSaveAsDefaults"
          />
          <label for="save-defaults-checkbox" class="text-sm text-gray-700">
            Save these values for future runs of this workflow
          </label>
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
