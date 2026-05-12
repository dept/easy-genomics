<script setup lang="ts">
  import { CreateWorkflowLaunchRequest } from '@/packages/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
  import EGAccordion from '@FE/components/EGAccordion.vue';
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import { Pipeline as SeqeraPipeline } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';

  const props = defineProps<{
    schema: object;
    params: object;
    labId: string;
    pipelineId: string;
    seqeraRunTempId: string;
  }>();

  const { $api } = useNuxtApp();

  const runStore = useRunStore();
  const seqeraPipelineStore = useSeqeraPipelinesStore();
  const labsStore = useLabsStore();

  const labName = labsStore.labs[props.labId]?.Name ?? '';
  const labNextFlowTowerApiBaseUrl = labsStore.labs[props.labId]?.NextFlowTowerApiBaseUrl ?? '';
  const isLaunchingRun = ref(false);
  const emit = defineEmits(['submit-launch-request', 'submit-launch-request-error', 'has-launched', 'previous-tab']);

  const remountAccordionKey = ref(0);
  const areAccordionsOpen = ref(true);

  const wipSeqeraRun = computed<WipRun | undefined>(() => runStore.wipSeqeraRuns[props.seqeraRunTempId]);
  const pipeline = computed<SeqeraPipeline | undefined>(() => seqeraPipelineStore.pipelines[props.pipelineId]);

  // Explicitly remove Seqera pipeline paramsText properties that contain variable references
  const paramsFiltered = Object.entries(props.params)
    // Sanity check to ensure key-value parameters
    .filter((param: string[]) => param.length == 2)
    // Filtering out properties where the value contains variable '${...}' references
    .filter((param: string[]) => !(typeof param[1] === 'string' && param[1].match(/\${([^}]*)\}/)))
    // Remove null entries
    .filter((el) => el != null)
    // Convert array to JSON Object that respects the value type
    .reduce((o, [key, value]) => ({ ...o, [key]: value }), {});
  const paramsText = JSON.stringify(paramsFiltered);
  const schema = JSON.parse(JSON.stringify(props.schema));

  const schemaDefinitions = schema.$defs || schema.definitions;

  async function launchRun() {
    emit('submit-launch-request');
    isLaunchingRun.value = true;

    // Tracked separately so the createLabRun catch can reference it even after
    // the external run has already been submitted successfully.
    let externalRunId: string | undefined;

    try {
      if (props.pipelineId === undefined) {
        throw new Error('pipeline id not found in wip run config');
      }

      let launchDetails;
      try {
        launchDetails = await $api.seqeraPipelines.readPipelineLaunchDetails(props.pipelineId, props.labId);
      } catch (error) {
        console.error('Error fetching pipeline launch details:', error);
        useToastStore().error('Unable to load launch configuration. Check lab Seqera settings and try again.');
        emit('submit-launch-request-error');
        return;
      }

      const workDir: string = `s3://${wipSeqeraRun.value?.s3Bucket}/${wipSeqeraRun.value?.s3Path}/work`;
      const launchRequest: CreateWorkflowLaunchRequest = {
        launch: {
          computeEnvId: launchDetails.launch?.computeEnv?.id,
          runName: wipSeqeraRun.value?.runName,
          pipeline: launchDetails.launch?.pipeline,
          revision: launchDetails.launch?.revision,
          configProfiles: launchDetails.launch?.configProfiles,
          workDir: workDir,
          paramsText: paramsText,
        },
      };

      let res;
      try {
        res = await $api.seqeraRuns.createPipelineRun(props.labId, props.pipelineId, launchRequest);
        if (!res?.workflowId) throw new Error('Workflow ID is missing in the response');
        externalRunId = res.workflowId;
      } catch (error) {
        console.error('Error submitting run to Seqera:', error);
        useToastStore().error('Failed to submit run to Seqera. Please try again.');
        emit('submit-launch-request-error');
        return;
      }

      try {
        const labRunRequest = {
          'LaboratoryId': props.labId,
          'RunId': wipSeqeraRun.value?.transactionId,
          'RunName': wipSeqeraRun.value?.runName,
          'Platform': 'Seqera Cloud',
          'PlatformApiBaseUrl': labNextFlowTowerApiBaseUrl,
          'Status': 'SUBMITTED',
          'WorkflowName': pipeline.value?.name,
          'ExternalRunId': externalRunId,
          'InputS3Url': props.params.input.substring(0, props.params.input.lastIndexOf('/')),
          'OutputS3Url': props.params.outdir,
          'SampleSheetS3Url': props.params.input,
          'Settings': paramsText,
        };
        await $api.labs.createLabRun(labRunRequest);
      } catch (error) {
        console.error('Error recording lab run after successful Seqera submission:', error);
        useToastStore().error(
          `Your run was submitted but could not be recorded. Contact support with run ID: ${externalRunId}.`,
        );
        emit('submit-launch-request-error');
        return;
      }

      delete runStore.wipSeqeraRuns[props.seqeraRunTempId];
      emit('has-launched');
    } catch (error) {
      console.error('Unexpected error launching run:', error);
      useToastStore().error('An unexpected error occurred while launching the run. Please try again.');
      emit('submit-launch-request-error');
    } finally {
      isLaunchingRun.value = false;
    }
  }

  const accordionItems = computed(() => {
    return Object.keys(schemaDefinitions).map((sectionName) => {
      const section = schemaDefinitions[sectionName];
      return {
        label: section.title,
        defaultOpen: true,
        content: {
          section,
          sectionName,
          properties: section.properties,
        },
      };
    });
  });

  // there's no apparent 'open/close' UAccordion method to tap into, so instead
  // we toggle the open state of each accordion it and re-initialize the
  // accordion component with this updated state
  function toggleAccordions() {
    areAccordionsOpen.value = !areAccordionsOpen.value;

    accordionItems.value.forEach((item) => {
      item.defaultOpen = areAccordionsOpen.value;
    });

    remountAccordionKey.value++;
  }
</script>

<template>
  <EGCard class="mb-6">
    <EGText tag="small" class="mb-4">Step 04</EGText>
    <EGText tag="h4" class="mb-0">Run Details</EGText>
    <UDivider class="py-4" />
    <section class="stroke-light flex flex-col bg-white">
      <dl>
        <div class="text-md flex border-b px-4 py-4">
          <dt class="w-48 text-black">Pipeline</dt>
          <dd class="text-muted text-left">{{ pipeline?.name }}</dd>
        </div>
        <div class="text-md flex border-b px-4 py-4">
          <dt class="w-48 text-black">Laboratory</dt>
          <dd class="text-muted text-left">{{ labName }}</dd>
        </div>
        <div class="text-md flex px-4 py-4">
          <dt class="w-48 text-black">Run Name</dt>
          <dd class="text-muted text-left">{{ wipSeqeraRun?.runName }}</dd>
        </div>
      </dl>
    </section>
  </EGCard>
  <EGCard>
    <div class="mb-4 flex items-center justify-between">
      <EGText tag="h4" class="text-muted">Selected Workflow Parameters</EGText>
      <EGButton
        variant="secondary"
        :label="areAccordionsOpen ? 'Collapse All' : 'Expand All'"
        @click="toggleAccordions"
      />
    </div>
    <EGAccordion :items="accordionItems" :key="remountAccordionKey">
      <template #item="{ item, open }">
        <section class="stroke-light flex flex-col bg-white text-left">
          <dl>
            <template v-for="(property, propertyKey, index) in item.content.properties">
              <div
                v-if="!property.hidden"
                :key="`property-${propertyKey}`"
                class="property-row grid grid-cols-[auto_1fr] gap-x-4 border-b bg-white px-4 py-4 last:border-0 dark:bg-gray-800"
              >
                <dt class="w-56 whitespace-pre-wrap break-words font-medium text-black">{{ propertyKey }}</dt>
                <dd class="text-muted whitespace-pre-wrap break-words">{{ params[propertyKey] }}</dd>
              </div>
            </template>
          </dl>
        </section>
      </template>
    </EGAccordion>
  </EGCard>

  <div class="mt-6 flex justify-between">
    <EGButton :size="ButtonSizeEnum.enum.sm" variant="secondary" label="Previous step" @click="emit('previous-tab')" />
    <EGButton :loading="isLaunchingRun" :size="ButtonSizeEnum.enum.sm" @click="launchRun" label="Launch Pipeline Run" />
  </div>
</template>

<style scoped>
  .property-row {
    &:last-child {
      border-bottom: none;
      margin-bottom: 16px;
    }
  }
</style>
