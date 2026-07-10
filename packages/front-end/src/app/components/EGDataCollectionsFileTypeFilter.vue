<script setup lang="ts">
  import type { DataCollectionFileTypeFilter } from '@FE/utils/data-collections-file-type';
  import { fileTypeFilterTriggerLabel } from '@FE/utils/data-collections-file-type';

  const props = defineProps<{
    modelValue: DataCollectionFileTypeFilter;
    counts: { fastq: number; fasta: number; other: number };
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: DataCollectionFileTypeFilter];
  }>();

  const filterOpen = defineModel<boolean>('open', { default: false });

  const triggerLabel = computed(() => fileTypeFilterTriggerLabel(props.modelValue));

  const isFilterActive = computed(() => !(props.modelValue.fastq && props.modelValue.fasta && props.modelValue.other));

  function setKind(kind: keyof DataCollectionFileTypeFilter, enabled: boolean): void {
    emit('update:modelValue', { ...props.modelValue, [kind]: enabled });
  }

  const rows = [
    {
      kind: 'fastq' as const,
      title: 'FASTQ',
      description: 'Raw sequencing reads (.fastq.gz)',
    },
    {
      kind: 'fasta' as const,
      title: 'FASTA',
      description: 'Reference genomes and assemblies (.fasta, .fa)',
    },
    {
      kind: 'other' as const,
      title: 'Workflow outputs & other',
      description: 'Logs, CSV reports, HTML summaries, archives. Rarely used as inputs.',
      separated: true,
    },
  ];
</script>

<template>
  <UPopover v-model:open="filterOpen" :popper="{ placement: 'bottom-end' }">
    <span
      class="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700"
      :class="{ 'ring-primary/30 ring-1': isFilterActive }"
      :aria-label="`File type filter: ${triggerLabel}`"
    >
      {{ triggerLabel }}
      <UIcon name="i-heroicons-chevron-down" class="h-4 w-4 shrink-0" aria-hidden="true" />
    </span>

    <template #panel>
      <div class="w-[min(17.5rem,calc(100vw-2rem))] py-1" role="listbox" aria-label="File type filter">
        <template v-for="row in rows" :key="row.kind">
          <div v-if="row.separated" class="mx-3 my-2 border-t border-gray-200" />
          <div
            class="flex items-start justify-evenly gap-2 px-3 py-2.5 hover:bg-gray-50"
            role="option"
            :aria-selected="modelValue[row.kind]"
          >
            <UCheckbox
              class="mt-0.5 shrink-0"
              :model-value="modelValue[row.kind]"
              :label="row.title"
              :ui="{ label: 'sr-only' }"
              @update:model-value="setKind(row.kind, $event)"
            />
            <div class="min-w-0 max-w-[11rem] flex-1">
              <div class="text-sm font-medium text-gray-900">{{ row.title }}</div>
              <div class="text-muted text-xs leading-snug">{{ row.description }}</div>
            </div>
            <UBadge
              size="xs"
              class="bg-primary-muted text-primary-dark mt-0.5 shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
            >
              {{ counts[row.kind] }}
            </UBadge>
          </div>
        </template>

        <div class="mt-1 border-t border-gray-200 px-3 py-2.5">
          <p class="text-muted text-xs leading-relaxed">
            FASTQ are the raw sequencing reads most workflows expect. FASTA includes reference genomes and assembled
            outputs — needed for downstream workflows like phylogenetic comparison.
          </p>
        </div>
      </div>
    </template>
  </UPopover>
</template>
