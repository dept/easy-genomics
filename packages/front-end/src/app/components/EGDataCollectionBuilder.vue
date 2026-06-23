<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type {
    LaboratorySequenceCollection,
    LaboratorySample,
    SampleSheetColumnDef,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import {
    SAMPLE_SHEET_COLUMN_ROLE_LABELS,
    SAMPLE_SHEET_SCHEMA_PRESETS,
    validateSampleSheetSchema,
  } from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
  import { useToastStore, useUiStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
    lab: Laboratory | null;
    samples: LaboratorySample[];
    initialSetIds: string[];
    initialName?: string;
    editingCollection?: LaboratorySequenceCollection | null;
  }>();

  const emit = defineEmits<{ back: []; saved: [] }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const isEditing = computed(() => Boolean(props.editingCollection));

  function columnsMatchPreset(cols: SampleSheetColumnDef[], preset: SampleSheetColumnDef[]): boolean {
    if (cols.length !== preset.length) return false;
    return cols.every((col, i) => {
      const p = preset[i];
      return col.columnName === p.columnName && col.role === p.role && col.required === p.required;
    });
  }

  function detectMatchingPresetKey(cols: SampleSheetColumnDef[]): string {
    for (const key of Object.keys(SAMPLE_SHEET_SCHEMA_PRESETS)) {
      if (columnsMatchPreset(cols, SAMPLE_SHEET_SCHEMA_PRESETS[key])) return key;
    }
    return 'custom';
  }

  const initialColumns: SampleSheetColumnDef[] = props.editingCollection?.Columns?.length
    ? props.editingCollection.Columns.map((col) => ({ ...col }))
    : SAMPLE_SHEET_SCHEMA_PRESETS.nf_core_paired_end.map((c) => ({ ...c }));

  const name = ref(props.initialName || props.editingCollection?.Name || '');
  const selectedSetIds = ref<Set<string>>(new Set(props.initialSetIds));
  const columns = ref<SampleSheetColumnDef[]>(initialColumns);
  const presetKey = ref(
    props.editingCollection?.Columns?.length ? detectMatchingPresetKey(initialColumns) : 'nf_core_paired_end',
  );
  const setSearch = ref('');
  const saving = ref(false);

  const presetOptions = computed(() => {
    const options = Object.keys(SAMPLE_SHEET_SCHEMA_PRESETS).map((k) => ({
      label: k.replace(/_/g, ' '),
      value: k,
    }));
    if (presetKey.value === 'custom') {
      return [{ label: 'Custom', value: 'custom' }, ...options];
    }
    return options;
  });

  watch(presetKey, (key) => {
    if (key === 'custom') return;
    const preset = SAMPLE_SHEET_SCHEMA_PRESETS[key];
    if (preset) columns.value = preset.map((c) => ({ ...c }));
  });

  const selectedSets = computed(() => props.samples.filter((s) => selectedSetIds.value.has(s.SampleId)));

  const filteredSets = computed(() => {
    const q = setSearch.value.trim().toLowerCase();
    if (!q) return props.samples;
    return props.samples.filter((s) => s.Name.toLowerCase().includes(q));
  });

  const preview = computed(() => {
    const header = columns.value.map((c) => c.columnName);
    const sampleCol = columns.value.find((c) => c.role === 'sample_id');
    const rows = selectedSets.value
      .slice(0, 6)
      .map((s) => columns.value.map((col) => (col.role === 'sample_id' || col === sampleCol ? s.Name : '…')));
    return { header, rows };
  });

  function toggleSet(id: string): void {
    const next = new Set(selectedSetIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedSetIds.value = next;
  }

  function addColumn(): void {
    columns.value.push({ columnName: `col_${columns.value.length + 1}`, role: 'metadata', required: false });
    presetKey.value = 'custom';
  }

  function removeColumn(idx: number): void {
    columns.value.splice(idx, 1);
    presetKey.value = 'custom';
  }

  async function save(): Promise<void> {
    const validation = validateSampleSheetSchema(columns.value);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    if (!name.value.trim() || !selectedSetIds.value.size) {
      toast.error('Name and at least one sample are required');
      return;
    }
    saving.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      if (props.editingCollection) {
        await $api.dataCollections.updateSequenceCollection({
          LaboratoryId: props.labId,
          SequenceCollectionId: props.editingCollection.SequenceCollectionId,
          Name: name.value.trim(),
          Columns: columns.value,
          SampleIds: [...selectedSetIds.value],
        });
        toast.success('Sequence collection updated');
      } else {
        await $api.dataCollections.createSequenceCollection({
          LaboratoryId: props.labId,
          Name: name.value.trim(),
          Columns: columns.value,
          SampleIds: [...selectedSetIds.value],
        });
        toast.success('Sequence collection saved');
      }
      emit('saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save collection');
    } finally {
      saving.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <button type="button" class="hover:text-primary mb-3 w-fit text-sm text-gray-500" @click="emit('back')">
      ← Back
    </button>
    <h1 class="mb-4 text-2xl font-medium">{{ isEditing ? 'Edit collection' : 'New sequence collection' }}</h1>

    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden rounded-t-xl border border-gray-200 bg-white lg:grid-cols-2"
    >
      <div class="space-y-5 overflow-y-auto border-r border-gray-200 p-5">
        <UFormGroup label="Collection name">
          <UInput v-model="name" />
        </UFormGroup>

        <div>
          <label class="mb-2 block text-sm font-medium">Samples · {{ selectedSetIds.size }} selected</label>
          <UInput v-model="setSearch" placeholder="Search…" class="mb-2" />
          <div class="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
            <label
              v-for="s in filteredSets"
              :key="s.SampleId"
              class="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
            >
              <input type="checkbox" :checked="selectedSetIds.has(s.SampleId)" @change="toggleSet(s.SampleId)" />
              <span class="flex-1">{{ s.Name }}</span>
              <span class="text-xs text-gray-400">{{ s.FileCount }} files</span>
            </label>
          </div>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <label class="text-sm font-medium">Schema</label>
            <USelect v-model="presetKey" :options="presetOptions" class="w-48" />
          </div>
          <table class="w-full overflow-hidden rounded-lg border border-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-2 text-left text-xs">Column</th>
                <th class="p-2 text-left text-xs">Role</th>
                <th class="w-8" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(col, idx) in columns" :key="idx" class="border-t">
                <td class="p-2"><UInput v-model="col.columnName" size="xs" class="font-mono" /></td>
                <td class="p-2">
                  <USelect
                    v-model="col.role"
                    size="xs"
                    :options="
                      Object.entries(SAMPLE_SHEET_COLUMN_ROLE_LABELS).map(([value, label]) => ({ value, label }))
                    "
                  />
                </td>
                <td class="p-2">
                  <button type="button" class="text-gray-400 hover:text-red-600" @click="removeColumn(idx)">×</button>
                </td>
              </tr>
            </tbody>
          </table>
          <button type="button" class="text-primary mt-2 text-sm" @click="addColumn">+ Add column</button>
        </div>
      </div>

      <div class="flex min-h-0 flex-col bg-gray-50">
        <div class="border-b border-gray-200 p-4 text-sm font-medium">
          Sample sheet preview · {{ selectedSetIds.size }} rows
        </div>
        <div class="flex-1 overflow-auto p-4">
          <table class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white font-mono text-xs">
            <thead class="bg-primary-50">
              <tr>
                <th v-for="h in preview.header" :key="h" class="p-2 text-left">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in preview.rows" :key="ri" class="border-t">
                <td v-for="(cell, ci) in row" :key="ci" class="max-w-[200px] truncate p-2">{{ cell || '—' }}</td>
              </tr>
              <tr v-if="selectedSetIds.size > 5">
                <td :colspan="preview.header.length" class="p-2 text-center italic text-gray-400">
                  …{{ selectedSetIds.size - 5 }} more rows
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-2 rounded-b-xl border border-t-0 border-gray-200 bg-white p-4">
      <UButton variant="ghost" @click="emit('back')">Cancel</UButton>
      <UButton :loading="saving" @click="save">{{ isEditing ? 'Save changes' : 'Save collection' }}</UButton>
    </div>
  </div>
</template>
