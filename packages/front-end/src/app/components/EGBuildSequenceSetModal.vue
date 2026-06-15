<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { SequenceSetLayout } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import { useToastStore, useUiStore } from '@FE/stores';

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    selectedKeys: string[];
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    created: [];
  }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const name = ref('');
  const layout = ref<SequenceSetLayout>('paired_end');
  const submitting = ref(false);

  watch(
    () => props.modelValue,
    (open) => {
      if (!open) return;
      const first = props.selectedKeys[0]?.split('/').pop() || 'sample';
      const base = first.replace(/_R[12].*$/i, '').replace(/\.R[12].*$/i, '');
      name.value = base || 'sample';
      const hasR2 = props.selectedKeys.some((k) => /R2/i.test(k.split('/').pop() || ''));
      layout.value = hasR2 ? 'paired_end' : 'single_end';
    },
  );

  function close(): void {
    emit('update:modelValue', false);
  }

  async function submit(): Promise<void> {
    if (!props.lab?.S3Bucket || !name.value.trim() || !props.selectedKeys.length) return;
    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.createSequenceSet({
        LaboratoryId: props.labId,
        S3Bucket: props.lab.S3Bucket,
        Name: name.value.trim(),
        Layout: layout.value,
        Keys: props.selectedKeys,
      });
      toast.success('Sequence set created');
      emit('created');
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to create sequence set');
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <UModal :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <div class="p-6">
      <h2 class="mb-1 text-lg font-medium">Build sequence set</h2>
      <p class="mb-4 text-sm text-gray-500">Group the selected files into one sequence set.</p>
      <div class="mb-4 space-y-3">
        <div v-for="key in selectedKeys" :key="key" class="truncate font-mono text-xs text-gray-600">{{ key }}</div>
      </div>
      <UFormGroup label="Sample ID" class="mb-3">
        <UInput v-model="name" />
      </UFormGroup>
      <UFormGroup label="Layout" class="mb-4">
        <USelect
          v-model="layout"
          :options="[
            { label: 'Paired-end', value: 'paired_end' },
            { label: 'Single-end', value: 'single_end' },
            { label: 'Long reads', value: 'long_reads' },
            { label: 'Paired-end with extras', value: 'paired_end_with_extras' },
          ]"
        />
      </UFormGroup>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="close">Cancel</UButton>
        <UButton :loading="submitting" @click="submit">Create sequence set</UButton>
      </div>
    </div>
  </UModal>
</template>
