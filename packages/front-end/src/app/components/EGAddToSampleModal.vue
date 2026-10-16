<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratorySample } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import { upgradeLayoutForAddedFiles } from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
  import { useDataCollectionsStore, useToastStore, useUiStore } from '@FE/stores';
  import { SAMPLE_LAYOUT_LABELS } from '@FE/utils/data-collections-selection';

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    fileKeys: string[];
    samples: LaboratorySample[];
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    saved: [];
  }>();

  const dataCollectionsStore = useDataCollectionsStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const selectedSampleId = ref<string | undefined>(undefined);
  const submitting = ref(false);

  const sampleOptions = computed(() =>
    [...props.samples]
      .sort((a, b) => a.Name.localeCompare(b.Name))
      .map((sample) => ({ label: sample.Name, value: sample.SampleId })),
  );

  const selectedSample = computed(() => props.samples.find((sample) => sample.SampleId === selectedSampleId.value));

  const layoutChange = computed(() => {
    const sample = selectedSample.value;
    if (!sample) return null;
    const upgradedLayout = upgradeLayoutForAddedFiles(sample.Layout, props.fileKeys, sample.SampleIdPattern);
    if (upgradedLayout === sample.Layout) return null;
    return {
      from: SAMPLE_LAYOUT_LABELS[sample.Layout] ?? sample.Layout,
      to: SAMPLE_LAYOUT_LABELS[upgradedLayout] ?? upgradedLayout,
    };
  });

  const canSubmit = computed(
    () => !!props.lab?.S3Bucket && !!selectedSample.value && props.fileKeys.length > 0 && !submitting.value,
  );

  watch(
    () => props.modelValue,
    (open) => {
      if (open) selectedSampleId.value = undefined;
    },
  );

  function fileName(key: string): string {
    return key.split('/').pop() ?? key;
  }

  function close(): void {
    emit('update:modelValue', false);
  }

  async function submit(): Promise<void> {
    const sample = selectedSample.value;
    const s3Bucket = props.lab?.S3Bucket;
    if (!canSubmit.value || !sample || !s3Bucket) return;
    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const added = await dataCollectionsStore.addFilesToSample({
        labId: props.labId,
        s3Bucket,
        sampleId: sample.SampleId,
        keys: props.fileKeys,
      });
      if (!added) return;
      toast.success(`Added ${props.fileKeys.length} file(s) to ${sample.Name}.`);
      emit('saved');
      close();
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <UModal :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Add to sample</h3>
          <UButton color="gray" variant="ghost" icon="i-heroicons-x-mark-20-solid" @click="close" />
        </div>
      </template>

      <div class="space-y-4">
        <div>
          <p class="text-muted mb-2 text-sm">{{ fileKeys.length }} file(s) selected</p>
          <div class="max-h-32 space-y-1 overflow-y-auto">
            <div v-for="key in fileKeys" :key="key" class="truncate font-mono text-xs text-gray-600">
              {{ fileName(key) }}
            </div>
          </div>
        </div>

        <div>
          <label class="text-muted mb-1 block text-xs font-medium">Sample</label>
          <USelectMenu
            v-model="selectedSampleId"
            :options="sampleOptions"
            value-attribute="value"
            option-attribute="label"
            placeholder="Select sample"
            searchable
          />
        </div>

        <p v-if="layoutChange" class="text-sm text-gray-600">
          Layout will change from {{ layoutChange.from }} to {{ layoutChange.to }}.
        </p>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="close">Cancel</UButton>
          <UButton :disabled="!canSubmit" :loading="submitting" @click="submit">Add files</UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
