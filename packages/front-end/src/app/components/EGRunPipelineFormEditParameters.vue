<script setup lang="ts">
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import { useRunStore, useToastStore } from '@FE/stores';
  import StringField from './EGParametersStringField.vue';
  import NumberField from './EGParametersNumberField.vue';
  import BooleanField from './EGParametersBooleanField.vue';

  const props = defineProps<{
    schema: object;
    params: object;
    labId: string;
    pipelineId: string;
    seqeraRunTempId: string;
  }>();

  const emit = defineEmits(['next-step', 'previous-step', 'step-validated']);

  const activeSection = ref<string | null>(null);

  const runStore = useRunStore();
  const labsStore = useLabsStore();
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const uiStore = useUiStore();

  const wipSeqeraRun = computed<WipRun | undefined>(() => runStore.wipSeqeraRuns[props.seqeraRunTempId]);

  const labName = computed<string | null>(() => labsStore.labs[props.labId]?.Name || null);
  const pipelineName = computed<string | null>(() => seqeraPipelinesStore.pipelines[props.pipelineId]?.name || null);

  const localProps = reactive({
    schema: props.schema,
    params: props.params,
  });

  const schemaDefinitions = computed(() => props.schema.$defs || props.schema.definitions);

  // Auto-populate runname/run_name parameter with the run name from Run Details
  function autoPopulateRunName() {
    const runName = wipSeqeraRun.value?.runName;
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

  onMounted(() => {
    // set first section in side panel of UI to active
    const firstKey = Object.keys(schemaDefinitions.value)[0];
    activeSection.value = schemaDefinitions.value[firstKey].title;

    // Auto-populate run name parameters
    autoPopulateRunName();
  });

  function nextSection() {
    const currentIndex = Object.values(schemaDefinitions.value).findIndex(
      (section) => section.title == activeSection.value,
    );
    if (currentIndex < Object.values(schemaDefinitions.value).length - 1) {
      activeSection.value = Object.values(schemaDefinitions.value)[currentIndex + 1].title;
    }
  }

  function prevSection() {
    if (!props.schema || !schemaDefinitions.value) {
      return; // Exit if schema or definitions is not available
    }
    const definitionsArray = Object.values(schemaDefinitions.value);
    const currentIndex = definitionsArray.findIndex((section) => section.title === activeSection.value);

    if (currentIndex > 0) {
      activeSection.value = definitionsArray[currentIndex - 1].title;
    }
  }

  function toggleSection(sectionTitle: string) {
    if (activeSection.value !== sectionTitle) {
      activeSection.value = sectionTitle;
    }
  }

  /**
   * Check if all parameters in a section are hidden; this is a helper to
   * hide the section in the side panel
   * @param section
   * @returns boolean
   */
  function checkIfAllSectionParametersHidden(section: object): boolean {
    const filteredProperties = Object.values(section.properties).filter(
      (property: any) => !usePipeline().isParamsFormatFilePath(property.format),
    );

    return filteredProperties.every((property: any) => property.hidden);
  }

  function onSubmit() {
    const paramsRequired: string[] = wipSeqeraRun.value?.paramsRequired || [];
    const missingParams = paramsRequired.filter((paramName: string) => !wipSeqeraRun.value?.params[paramName]);

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
      if (val) runStore.updateWipSeqeraRunParams(props.seqeraRunTempId, val);
    },
    { deep: true },
  );

  // Watch for changes in run name and auto-populate if needed
  watch(
    () => wipSeqeraRun.value?.runName,
    (newRunName) => {
      if (newRunName) {
        autoPopulateRunName();
      }
    },
  );

  function componentForType(propertyType: 'string' | 'integer' | 'number' | 'boolean') {
    switch (propertyType) {
      case 'string':
        return StringField;
      case 'integer':
      case 'number':
        return NumberField;
      case 'boolean':
        return BooleanField;
    }
  }
</script>

<template>
  <EGS3SampleSheetBar
    v-if="wipSeqeraRun?.sampleSheetS3Url || uiStore.isRequestPending('generateSampleSheet')"
    :url="wipSeqeraRun.sampleSheetS3Url"
    :lab-id="props.labId"
    :lab-name="labName"
    :pipeline-or-workflow-name="pipelineName"
    platform="Seqera Cloud"
    :run-name="wipSeqeraRun.runName"
    :display-label="true"
  />

  <div class="flex">
    <div class="mr-4 w-1/4">
      <EGCard>
        <EGText tag="small" class="mb-4">Step 03</EGText>
        <EGText tag="h4" class="mb-0">Edit Parameters</EGText>
        <UDivider class="py-4" />
        <div
          v-show="!checkIfAllSectionParametersHidden(section)"
          v-for="(section, sectionIndex) in schemaDefinitions"
          :key="`section-${sectionIndex}`"
        >
          <div
            class="mb-4 cursor-pointer text-sm"
            :class="{
              'text-primary bg-primary-muted rounded-xl px-4 py-2 font-semibold': activeSection === section.title,
            }"
            @click="toggleSection(section.title)"
          >
            {{ section.title }}
          </div>
        </div>
      </EGCard>
    </div>
    <div class="w-3/4">
      <EGCard
        v-for="(section, sectionIndex) in Object.values(schemaDefinitions)"
        :key="`section-${sectionIndex}`"
        v-show="activeSection === section.title"
      >
        <EGText tag="h4" class="mb-4">{{ section.title }}</EGText>

        <div
          v-for="(section, sectionIndex) in Object.values(schemaDefinitions)"
          :key="`section-${sectionIndex}`"
          v-show="activeSection === section.title"
        >
          <div v-for="(propertyDetail, propertyName) in section.properties" :key="propertyName" class="mb-6">
            <template v-if="!propertyDetail?.hidden">
              <EGFormGroup
                :label="propertyName"
                :name="propertyName"
                :required="runStore.wipSeqeraRuns[props.seqeraRunTempId].paramsRequired.includes(propertyName)"
              >
                <component
                  :is="componentForType(propertyDetail.type)"
                  :description="propertyDetail.description"
                  :helpText="propertyDetail.help_text"
                  v-model="runStore.wipSeqeraRuns[props.seqeraRunTempId].params[propertyName]"
                />
              </EGFormGroup>
            </template>
          </div>
        </div>

        <div class="mt-12 flex justify-end">
          <EGButton
            v-if="sectionIndex > 0"
            :size="ButtonSizeEnum.enum.sm"
            variant="secondary"
            label="Previous"
            @click="prevSection"
          />
          <EGButton
            class="ml-4"
            v-if="sectionIndex < Object.keys(schemaDefinitions).length - 1"
            :size="ButtonSizeEnum.enum.sm"
            variant="secondary"
            label="Next"
            @click="nextSection"
          />
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
