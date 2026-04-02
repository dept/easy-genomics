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
    // Validation constraints
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };

  /**
   * Build a flat lookup of all parameter definitions from the nf-core JSON Schema.
   * The schema groups parameters into `definitions` sections, each with `properties`.
   */
  const nfSchemaDefMap = computed<Record<string, any>>(() => {
    const schema = props.nfSchema as any;
    const definitions = schema?.$defs || schema?.definitions;
    if (!definitions) return {};

    const map: Record<string, any> = {};
    for (const section of Object.values(definitions) as any[]) {
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
          minimum: paramDef.minimum,
          maximum: paramDef.maximum,
          exclusiveMinimum: paramDef.exclusiveMinimum,
          exclusiveMaximum: paramDef.exclusiveMaximum,
          pattern: paramDef.pattern,
          minLength: paramDef.minLength,
          maxLength: paramDef.maxLength,
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
  const fieldErrors = reactive<Record<string, string>>({});

  function validateField(field: SchemaItem, value: any): string | null {
    const isEmpty = value === '' || value === undefined || value === null;

    if (isEmpty && field.optional !== false) {
      return null;
    }

    if (isEmpty) {
      return null; // Required-field check is handled separately
    }

    if (field.type === 'integer') {
      if (!Number.isInteger(Number(value)) || isNaN(Number(value))) {
        return 'Must be a whole number';
      }
    } else if (field.type === 'number') {
      if (isNaN(Number(value))) {
        return 'Must be a valid number';
      }
    }

    if ((field.type === 'integer' || field.type === 'number') && !isNaN(Number(value))) {
      const numValue = Number(value);
      if (field.minimum !== undefined && numValue < field.minimum) {
        return `Must be at least ${field.minimum}`;
      }
      if (field.maximum !== undefined && numValue > field.maximum) {
        return `Must be at most ${field.maximum}`;
      }
      if (field.exclusiveMinimum !== undefined && numValue <= field.exclusiveMinimum) {
        return `Must be greater than ${field.exclusiveMinimum}`;
      }
      if (field.exclusiveMaximum !== undefined && numValue >= field.exclusiveMaximum) {
        return `Must be less than ${field.exclusiveMaximum}`;
      }
    }

    if (field.type === 'string' || (!field.type && typeof value === 'string')) {
      const strValue = String(value);
      if (field.minLength !== undefined && strValue.length < field.minLength) {
        return `Must be at least ${field.minLength} characters`;
      }
      if (field.maxLength !== undefined && strValue.length > field.maxLength) {
        return `Must be at most ${field.maxLength} characters`;
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(strValue)) {
            return 'Value does not match the expected format';
          }
        } catch {
          // Skip validation if the pattern regex is invalid
        }
      }
    }

    if (field.enum?.length) {
      const stringified = field.enum.map(String);
      if (!stringified.includes(String(value))) {
        return `Must be one of: ${field.enum.join(', ')}`;
      }
    }

    return null;
  }

  function validateAllFields(): boolean {
    let hasErrors = false;

    for (const field of orderedSchema.value) {
      const value = localProps.params[field.name];
      const error = validateField(field, value);
      if (error) {
        fieldErrors[field.name] = error;
        hasErrors = true;
      } else {
        delete fieldErrors[field.name];
      }
    }

    return !hasErrors;
  }

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
      return;
    }

    if (!validateAllFields()) {
      const errorCount = Object.keys(fieldErrors).length;
      useToastStore().error(
        `${errorCount} parameter${errorCount > 1 ? 's have' : ' has'} invalid values. Please fix the highlighted errors.`,
      );
      return;
    }

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

  watch(
    () => localProps.params,
    (val) => {
      if (val) runStore.updateWipOmicsRunParams(props.omicsRunTempId, val);

      // Re-validate fields that already have errors so they clear when fixed
      for (const fieldName of Object.keys(fieldErrors)) {
        const field = orderedSchema.value.find((f) => f.name === fieldName);
        if (field) {
          const error = validateField(field, val[fieldName]);
          if (!error) {
            delete fieldErrors[fieldName];
          } else {
            fieldErrors[fieldName] = error;
          }
        }
      }
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
            :error="fieldErrors[schemaField.name]"
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
