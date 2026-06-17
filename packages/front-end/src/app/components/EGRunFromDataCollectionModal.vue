<script setup lang="ts">
  import { v4 as uuidv4 } from 'uuid';
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratoryRunDataCollection } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
  import { useOmicsWorkflowsStore, useRunStore, useSeqeraPipelinesStore, useToastStore, useUiStore } from '@FE/stores';
  import {
    buildRunWizardUrl,
    defaultSampleSheetName,
    seedWipRunFromSampleSheet,
  } from '@FE/utils/run-upload-sample-sheet';

  export type WorkflowPickerOption = {
    key: string;
    id: string;
    label: string;
    platform: RunType;
  };

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    dataCollection: LaboratoryRunDataCollection | null;
  }>();

  const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

  const { $api } = useNuxtApp();
  const runStore = useRunStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const runName = ref('');
  const selectedWorkflowKey = ref<string | undefined>();
  const submitting = ref(false);

  const omicsAvailable = computed(() => !!props.lab?.AwsHealthOmicsEnabled);
  const seqeraAvailable = computed(() => !!props.lab?.NextFlowTowerEnabled && !!props.lab?.HasNextFlowTowerAccessToken);

  const workflowOptions = computed<WorkflowPickerOption[]>(() => {
    const options: WorkflowPickerOption[] = [];
    if (omicsAvailable.value) {
      for (const w of omicsWorkflowsStore.workflowsForLab(props.labId)) {
        if (!w.id) continue;
        options.push({ key: `AWS HealthOmics:${w.id}`, id: w.id, label: w.name || w.id, platform: 'AWS HealthOmics' });
      }
    }
    if (seqeraAvailable.value) {
      for (const p of seqeraPipelinesStore.pipelinesForLab(props.labId)) {
        if (p.pipelineId == null) continue;
        options.push({
          key: `Seqera Cloud:${p.pipelineId}`,
          id: String(p.pipelineId),
          label: p.name || String(p.pipelineId),
          platform: 'Seqera Cloud',
        });
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  });

  const selectedWorkflow = computed(() => workflowOptions.value.find((o) => o.key === selectedWorkflowKey.value));

  watch(
    () => props.modelValue,
    async (open) => {
      if (!open) return;
      runName.value = props.dataCollection?.Name ?? '';
      selectedWorkflowKey.value = undefined;
      const tasks: Promise<void>[] = [];
      if (omicsAvailable.value) tasks.push(omicsWorkflowsStore.loadWorkflowsForLab(props.labId));
      if (seqeraAvailable.value) tasks.push(seqeraPipelinesStore.loadPipelinesForLab(props.labId));
      await Promise.all(tasks);
    },
  );

  function close(): void {
    emit('update:modelValue', false);
  }

  async function continueToRun(): Promise<void> {
    const workflow = selectedWorkflow.value;
    if (!workflow || !props.lab?.S3Bucket || !props.dataCollection) return;
    submitting.value = true;
    uiStore.setRequestPending('runFromCollectionsWorkflows');
    try {
      const txId = uuidv4();
      const sheetName = defaultSampleSheetName(runName.value.trim() || props.dataCollection.Name);
      const result = await $api.dataCollections.generateDataCollectionSampleSheet({
        LaboratoryId: props.labId,
        S3Bucket: props.lab.S3Bucket,
        DataCollectionId: props.dataCollection.DataCollectionId,
        Platform: workflow.platform,
        TransactionId: txId,
        SampleSheetName: sheetName,
        ValidateS3FilesExist: true,
      });

      const tempId = seedWipRunFromSampleSheet({
        lab: props.lab,
        labId: props.labId,
        runName: runName.value.trim() || props.dataCollection.Name,
        platform: workflow.platform,
        workflowExternalId: workflow.id,
        sampleSheetResult: result,
        transactionId: txId,
      });

      const url = buildRunWizardUrl(props.labId, workflow.platform, workflow.id, tempId);
      window.open(url, '_blank', 'noopener,noreferrer');
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to start run from data collection.');
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('runFromCollectionsWorkflows');
    }
  }
</script>

<template>
  <UModal :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <UCard>
      <template #header>
        <h3 class="text-base font-semibold">Run from data collection</h3>
      </template>
      <div v-if="dataCollection" class="space-y-4">
        <p class="text-muted text-sm">
          Generate a sample sheet from
          <strong>{{ dataCollection.Name }}</strong>
          ({{ dataCollection.SequenceSetCount }}
          sequence set(s)) and open the run wizard.
        </p>
        <div>
          <label class="text-muted mb-1 block text-xs font-medium">Run name</label>
          <UInput v-model="runName" />
        </div>
        <div>
          <label class="text-muted mb-1 block text-xs font-medium">Workflow</label>
          <USelectMenu
            v-model="selectedWorkflowKey"
            :options="workflowOptions"
            value-attribute="key"
            option-attribute="label"
            placeholder="Select workflow"
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="close">Cancel</UButton>
          <UButton :disabled="!selectedWorkflow || !runName.trim()" :loading="submitting" @click="continueToRun">
            Continue
          </UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
