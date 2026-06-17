<script setup lang="ts">
  import { v4 as uuidv4 } from 'uuid';
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type {
    LaboratoryRunDataCollection,
    SampleSheetColumnDef,
    SampleSheetColumnRole,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import { RUN_DATA_COLLECTION_NAME_MAX_LENGTH } from '@easy-genomics/shared-lib/src/app/constants/data-collections';
  import {
    SAMPLE_SHEET_COLUMN_ROLE_LABELS,
    SAMPLE_SHEET_SCHEMA_PRESETS,
    validateSampleSheetSchema,
  } from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { selectedSequenceSetIds, type ExplorerSelection } from '@FE/utils/data-collections-selection';

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    selection: ExplorerSelection;
    dataCollections: LaboratoryRunDataCollection[];
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
  const existingCollectionId = ref<string | undefined>(undefined);
  const presetKey = ref<string>('nf_core_paired_end');
  const columns = ref<SampleSheetColumnDef[]>([...SAMPLE_SHEET_SCHEMA_PRESETS.nf_core_paired_end]);
  const submitting = ref(false);
  const generateAfterSave = ref(false);

  const setIds = computed(() => selectedSequenceSetIds(props.selection));

  const roleOptions = computed(() =>
    (Object.keys(SAMPLE_SHEET_COLUMN_ROLE_LABELS) as SampleSheetColumnRole[]).map((value) => ({
      value,
      label: SAMPLE_SHEET_COLUMN_ROLE_LABELS[value],
    })),
  );

  const presetOptions = computed(() =>
    Object.keys(SAMPLE_SHEET_SCHEMA_PRESETS).map((key) => ({
      value: key,
      label: key.replace(/_/g, ' '),
    })),
  );

  const nameInvalid = computed(
    () => mode.value === 'create' && name.value.trim().length > RUN_DATA_COLLECTION_NAME_MAX_LENGTH,
  );

  const schemaError = computed(() => {
    const r = validateSampleSheetSchema(columns.value);
    return r.ok ? null : r.message;
  });

  const canSubmit = computed(() => {
    if (!setIds.value.length || submitting.value || schemaError.value) return false;
    if (mode.value === 'create') return !!name.value.trim() && !nameInvalid.value;
    return !!existingCollectionId.value;
  });

  watch(presetKey, (key) => {
    const preset = SAMPLE_SHEET_SCHEMA_PRESETS[key];
    if (preset) columns.value = preset.map((c) => ({ ...c }));
  });

  watch(
    () => props.modelValue,
    (open) => {
      if (!open) return;
      mode.value = 'create';
      name.value = '';
      existingCollectionId.value = undefined;
      presetKey.value = 'nf_core_paired_end';
      columns.value = [...SAMPLE_SHEET_SCHEMA_PRESETS.nf_core_paired_end];
      generateAfterSave.value = false;
    },
  );

  function close(): void {
    emit('update:modelValue', false);
  }

  function addColumn(): void {
    columns.value.push({ columnName: `col_${columns.value.length + 1}`, role: 'custom_uri', required: false });
  }

  function removeColumn(index: number): void {
    columns.value.splice(index, 1);
  }

  async function submit(generate: boolean): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const collection = await $api.dataCollections.createDataCollection({
        LaboratoryId: props.labId,
        Columns: columns.value,
        SequenceSetIds: setIds.value,
        ...(mode.value === 'create'
          ? { Name: name.value.trim() }
          : { ExistingDataCollectionId: existingCollectionId.value! }),
      });

      if (generate && props.lab?.S3Bucket) {
        const txId = uuidv4();
        const sheetName = `samplesheet-${name.value.trim() || collection.Name}.csv`.replace(/\s+/g, '-');
        await $api.dataCollections.generateDataCollectionSampleSheet({
          LaboratoryId: props.labId,
          S3Bucket: props.lab.S3Bucket,
          DataCollectionId: collection.DataCollectionId,
          Platform: 'AWS HealthOmics',
          TransactionId: txId,
          SampleSheetName: sheetName,
          ValidateS3FilesExist: true,
        });
        toast.success('Data collection saved and sample sheet generated.');
      } else {
        toast.success(mode.value === 'create' ? 'Data collection created.' : 'Sequence sets added to data collection.');
      }

      emit('saved');
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save data collection.');
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <UModal :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <UCard :ui="{ body: { base: 'max-h-[70vh] overflow-y-auto' } }">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Add to data collection</h3>
          <UButton color="gray" variant="ghost" icon="i-heroicons-x-mark-20-solid" @click="close" />
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-muted text-sm">{{ setIds.length }} sequence set(s) selected</p>

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
          <label class="text-muted mb-1 block text-xs font-medium">Data collection name</label>
          <UInput v-model="name" placeholder="Name" :color="nameInvalid ? 'red' : undefined" />
        </div>
        <div v-else>
          <label class="text-muted mb-1 block text-xs font-medium">Existing data collection</label>
          <USelectMenu
            v-model="existingCollectionId"
            :options="dataCollections.map((c) => ({ label: c.Name, value: c.DataCollectionId }))"
            value-attribute="value"
            option-attribute="label"
            placeholder="Select data collection"
          />
        </div>

        <div v-if="mode === 'create'">
          <label class="text-muted mb-1 block text-xs font-medium">Schema preset</label>
          <USelectMenu v-model="presetKey" :options="presetOptions" value-attribute="value" option-attribute="label" />
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <span class="text-muted text-xs font-semibold uppercase tracking-wide">Sample sheet columns</span>
            <UButton size="xs" variant="soft" @click="addColumn">+ Add column</UButton>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted border-b text-left text-xs">
                <th class="pb-2 pr-2 font-medium">Column</th>
                <th class="pb-2 pr-2 font-medium">Role</th>
                <th class="pb-2 pr-2 font-medium">Required</th>
                <th class="w-8 pb-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(col, idx) in columns" :key="idx" class="border-b border-gray-100">
                <td class="py-2 pr-2">
                  <UInput v-model="col.columnName" size="sm" />
                </td>
                <td class="py-2 pr-2">
                  <USelectMenu
                    v-model="col.role"
                    :options="roleOptions"
                    value-attribute="value"
                    option-attribute="label"
                    size="sm"
                  />
                </td>
                <td class="py-2 pr-2">
                  <UCheckbox v-model="col.required" />
                </td>
                <td class="py-2">
                  <UButton
                    v-if="columns.length > 1"
                    size="xs"
                    color="gray"
                    variant="ghost"
                    icon="i-heroicons-trash"
                    @click="removeColumn(idx)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="schemaError" class="text-alert-danger-dark mt-2 text-xs">{{ schemaError }}</p>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton variant="ghost" @click="close">Cancel</UButton>
          <UButton :disabled="!canSubmit" :loading="submitting" variant="outline" @click="submit(false)">
            Save collection
          </UButton>
          <UButton :disabled="!canSubmit" :loading="submitting" @click="submit(true)">
            Save &amp; generate sample sheet
          </UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
