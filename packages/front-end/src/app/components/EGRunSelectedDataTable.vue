<script setup lang="ts">
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type { RunInputSource } from '@FE/utils/run-upload-sample-sheet';

  export type RunSelectedRow = {
    s3Key: string;
    sampleId: string;
    fileName: string;
    source: RunInputSource;
    tagIds: string[];
    progress?: number;
    error?: string;
    uploadInProgress?: boolean;
  };

  const props = defineProps<{
    rows: RunSelectedRow[];
    tags: LaboratoryDataTag[];
    disabled?: boolean;
    isUploadingSampleSheet?: boolean;
    showGenerateSampleSheet?: boolean;
    generateSampleSheetLoading?: boolean;
  }>();

  const emit = defineEmits<{
    remove: [row: RunSelectedRow];
    'clear-all': [];
    'upload-sample-sheet': [];
    'generate-sample-sheet': [];
    'update-tags': [payload: { s3Key: string; addTagIds: string[]; removeTagIds: string[] }];
  }>();

  const tagPopoverKey = ref<string | null>(null);

  function tagById(id: string): LaboratoryDataTag | undefined {
    return props.tags.find((t) => t.TagId === id);
  }

  function standardTagsForPicker(): LaboratoryDataTag[] {
    return props.tags.filter((t) => (t.Kind ?? 'standard') === 'standard' && t.Kind !== 'permanent');
  }

  function pillTextColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#1a1a2e' : '#ffffff';
  }

  function toggleTagOnRow(row: RunSelectedRow, tagId: string): void {
    const has = row.tagIds.includes(tagId);
    emit('update-tags', {
      s3Key: row.s3Key,
      addTagIds: has ? [] : [tagId],
      removeTagIds: has ? [tagId] : [],
    });
  }

  function removeTagFromRow(row: RunSelectedRow, tagId: string): void {
    emit('update-tags', { s3Key: row.s3Key, addTagIds: [], removeTagIds: [tagId] });
  }

  function sourceLabel(source: RunInputSource): string {
    return source === 'library' ? 'Library' : 'Upload';
  }
</script>

<template>
  <EGCard class="mt-4">
    <div class="px-7 pt-5">
      <div class="flex items-baseline gap-2">
        <h3 class="text-heading text-base font-semibold">Selected Data for Run</h3>
        <span class="text-primary text-sm font-medium">– {{ rows.length }} total</span>
      </div>
      <p class="text-muted mt-1 pb-4 text-xs">All selected data sources will be included in this run.</p>
    </div>

    <div v-if="!rows.length" class="text-muted px-7 pb-8 text-center text-sm">
      No data selected yet. Upload files or browse previously uploaded samples above.
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-border-muted border-y bg-gray-50/90 text-xs text-gray-500">
            <th class="px-5 py-2 font-medium">Sample ID</th>
            <th class="px-5 py-2 font-medium">Sample File</th>
            <th class="px-5 py-2 font-medium">Tags</th>
            <th class="px-5 py-2 font-medium">Source</th>
            <th class="w-12 px-3 py-2" scope="col"><span class="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.s3Key"
            class="border-border-muted border-b last:border-b-0"
            :class="{
              'bg-alert-danger-muted/40': row.error,
              'bg-alert-success-muted/30': row.progress === 100 && !row.error,
            }"
          >
            <td class="px-5 py-2.5 text-xs font-medium text-gray-900">
              <span v-if="row.error" class="text-alert-danger-dark">(Upload failed)</span>
              <span v-else class="truncate">{{ row.sampleId }}</span>
            </td>
            <td class="max-w-xs truncate px-5 py-2.5 text-xs text-gray-600">
              {{ row.fileName }}
              <div
                v-if="row.uploadInProgress && row.progress !== undefined && row.progress < 100"
                class="bg-border-muted mt-1 h-0.5 overflow-hidden rounded"
              >
                <div class="bg-primary h-full transition-all" :style="{ width: `${row.progress}%` }" />
              </div>
            </td>
            <td class="px-5 py-2.5">
              <div class="flex flex-wrap items-center gap-1">
                <span
                  v-for="tid in row.tagIds"
                  :key="tid"
                  class="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :style="{
                    background: tagById(tid)?.ColorHex || '#e2e2e8',
                    color: pillTextColor(tagById(tid)?.ColorHex || '#e2e2e8'),
                  }"
                >
                  {{ tagById(tid)?.Name || tid }}
                  <button
                    type="button"
                    class="opacity-60 hover:opacity-100"
                    :aria-label="`Remove tag ${tagById(tid)?.Name}`"
                    :disabled="disabled"
                    @click="removeTagFromRow(row, tid)"
                  >
                    ×
                  </button>
                </span>
                <UPopover
                  :open="tagPopoverKey === row.s3Key"
                  @update:open="(v: boolean) => (tagPopoverKey = v ? row.s3Key : null)"
                >
                  <UButton
                    size="xs"
                    variant="ghost"
                    class="text-primary border-primary/40 border border-dashed"
                    label="Add tag"
                    :disabled="disabled"
                  />
                  <template #panel>
                    <div class="max-h-48 w-48 overflow-y-auto p-2">
                      <p class="text-muted mb-1 px-1 text-[10px] font-semibold uppercase">Tags</p>
                      <button
                        v-for="t in standardTagsForPicker()"
                        :key="t.TagId"
                        type="button"
                        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-gray-100"
                        @click="toggleTagOnRow(row, t.TagId)"
                      >
                        <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: t.ColorHex }" />
                        <span class="flex-1">{{ t.Name }}</span>
                        <UIcon
                          v-if="row.tagIds.includes(t.TagId)"
                          name="i-heroicons-check"
                          class="text-primary h-4 w-4"
                        />
                      </button>
                    </div>
                  </template>
                </UPopover>
              </div>
            </td>
            <td class="px-5 py-2.5">
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="
                  row.source === 'library' ? 'bg-primary-muted text-primary-dark' : 'bg-emerald-50 text-emerald-800'
                "
              >
                {{ sourceLabel(row.source) }}
              </span>
            </td>
            <td class="px-3 py-2.5 text-right">
              <button
                type="button"
                class="text-muted hover:text-alert-danger rounded p-1"
                :aria-label="`Remove ${row.fileName}`"
                :disabled="disabled || row.uploadInProgress"
                @click="emit('remove', row)"
              >
                <UIcon name="i-heroicons-trash" class="h-4 w-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="border-border-muted flex flex-wrap items-center justify-between gap-3 border-t px-7 py-4">
      <EGButton
        variant="secondary"
        label="Upload Sample Sheet"
        icon="i-heroicons-arrow-up-tray"
        :loading="isUploadingSampleSheet"
        :disabled="isUploadingSampleSheet || disabled"
        @click="emit('upload-sample-sheet')"
      />
      <div class="flex gap-3">
        <EGButton
          v-if="showGenerateSampleSheet"
          variant="secondary"
          label="Generate Sample Sheet"
          :loading="generateSampleSheetLoading"
          @click="emit('generate-sample-sheet')"
        />
        <EGButton
          variant="secondary"
          label="Clear All"
          :disabled="!rows.length || disabled"
          @click="emit('clear-all')"
        />
      </div>
    </div>
  </EGCard>
</template>
