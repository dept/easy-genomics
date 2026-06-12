<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratorySample, SampleLayout } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import { SAMPLE_NAME_MAX_LENGTH } from '@easy-genomics/shared-lib/src/app/constants/data-collections';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { SAMPLE_LAYOUT_LABELS } from '@FE/utils/data-collections-selection';
  import { selectedFileKeys, type ExplorerSelection } from '@FE/utils/data-collections-selection';

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    selection: ExplorerSelection;
    samples: LaboratorySample[];
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    saved: [];
  }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  type Mode = 'create' | 'existing';
  const mode = ref<Mode>('create');
  const name = ref('');
  const layout = ref<SampleLayout>('paired_end');
  const filenameRegex = ref('');
  const expandRegex = ref(false);
  const existingSetId = ref<string | undefined>(undefined);
  const submitting = ref(false);

  const layoutOptions = computed(() =>
    (Object.keys(SAMPLE_LAYOUT_LABELS) as SampleLayout[]).map((value) => ({
      value,
      label: SAMPLE_LAYOUT_LABELS[value],
    })),
  );

  const fileKeys = computed(() => selectedFileKeys(props.selection));

  const nameInvalid = computed(() => mode.value === 'create' && name.value.trim().length > SAMPLE_NAME_MAX_LENGTH);

  const canSubmit = computed(() => {
    if (!props.lab?.S3Bucket || !fileKeys.value.length || submitting.value) return false;
    if (mode.value === 'create') return !!name.value.trim() && !nameInvalid.value;
    return !!existingSetId.value;
  });

  watch(
    () => props.modelValue,
    (open) => {
      if (!open) return;
      mode.value = 'create';
      name.value = '';
      layout.value = 'paired_end';
      filenameRegex.value = '';
      expandRegex.value = false;
      existingSetId.value = undefined;
    },
  );

  function close(): void {
    emit('update:modelValue', false);
  }

  async function submit(): Promise<void> {
    if (!canSubmit.value || !props.lab?.S3Bucket) return;
    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.createSample({
        LaboratoryId: props.labId,
        S3Bucket: props.lab.S3Bucket,
        ...(mode.value === 'create'
          ? { Name: name.value.trim(), Layout: layout.value }
          : { ExistingSampleId: existingSetId.value!, Layout: layout.value }),
        Keys: fileKeys.value,
        ...(filenameRegex.value.trim()
          ? { FilenameRegex: filenameRegex.value.trim(), ExpandRegexFromListing: expandRegex.value }
          : {}),
      });
      toast.success(mode.value === 'create' ? 'Sample created.' : 'Files added to sample.');
      emit('saved');
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save sample.');
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
        <p class="text-muted text-sm">{{ fileKeys.length }} file(s) selected</p>

        <div class="flex gap-4">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input v-model="mode" type="radio" value="create" class="text-primary" />
            Create new
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input v-model="mode" type="radio" value="existing" class="text-primary" />
            Add to existing
          </label>
        </div>

        <div v-if="mode === 'create'">
          <label class="text-muted mb-1 block text-xs font-medium">Sample name</label>
          <UInput v-model="name" placeholder="Name" :color="nameInvalid ? 'red' : undefined" />
          <p v-if="nameInvalid" class="text-alert-danger-dark mt-1 text-xs">
            {{ SAMPLE_NAME_MAX_LENGTH }} characters max
          </p>
        </div>

        <div v-else>
          <label class="text-muted mb-1 block text-xs font-medium">Existing sample</label>
          <USelectMenu
            v-model="existingSetId"
            :options="samples.map((s) => ({ label: s.Name, value: s.SampleId }))"
            value-attribute="value"
            option-attribute="label"
            placeholder="Select sample"
          />
        </div>

        <div v-if="mode === 'create'">
          <label class="text-muted mb-1 block text-xs font-medium">Layout</label>
          <USelectMenu v-model="layout" :options="layoutOptions" value-attribute="value" option-attribute="label" />
        </div>

        <div>
          <label class="text-muted mb-1 block text-xs font-medium">Filename regex (optional)</label>
          <UInput v-model="filenameRegex" placeholder="e.g. _R[12]_" />
          <label v-if="filenameRegex.trim()" class="mt-2 flex items-center gap-2 text-xs">
            <UCheckbox v-model="expandRegex" />
            Also include matching files from the lab bucket
          </label>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="close">Cancel</UButton>
          <UButton :disabled="!canSubmit" :loading="submitting" @click="submit">Save</UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
