<script setup lang="ts">
  import type { WorkflowKeyOutput } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import {
    WORKFLOW_KEY_OUTPUT_DESCRIPTION_MAX_LENGTH,
    WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import { isWholeFolderPattern } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { useToastStore, useUiStore, useWorkflowKeyOutputsStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
    workflowId: string;
    workflowName?: string;
    platform?: string;
    keyOutputs: WorkflowKeyOutput[];
    /** Preferred run used when these outputs were last marked. */
    sourceRunId?: string;
    /** Latest completed run, used when SourceRunId is missing. */
    fallbackRunId?: string;
  }>();

  const emit = defineEmits<{
    saved: [];
    markInRun: [];
  }>();

  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const uiStore = useUiStore();
  const toast = useToastStore();

  type DraftRow = {
    KeyOutputId: string;
    Label: string;
    Description: string;
    Pattern: string;
    ExamplePath?: string;
  };

  const draft = ref<DraftRow[]>([]);
  const savedSnapshot = ref('');
  /** Match counts by pattern from a completed run, when available. */
  const matchCountByPattern = ref<Record<string, number>>({});

  function snapshot(rows: DraftRow[]): string {
    return JSON.stringify(
      rows.map((row) => ({
        KeyOutputId: row.KeyOutputId,
        Label: row.Label.trim(),
        Description: row.Description.trim(),
        Pattern: row.Pattern.trim(),
      })),
    );
  }

  function syncFromProps(): void {
    draft.value = props.keyOutputs.map((item) => ({
      KeyOutputId: item.KeyOutputId,
      Label: item.Label,
      Description: item.Description ?? '',
      Pattern: item.Pattern,
      ExamplePath: item.ExamplePath,
    }));
    savedSnapshot.value = snapshot(draft.value);
  }

  watch(
    () => props.keyOutputs,
    () => syncFromProps(),
    { immediate: true, deep: true },
  );

  async function loadMatchCounts(): Promise<void> {
    const runId = props.sourceRunId || props.fallbackRunId;
    if (!runId) {
      matchCountByPattern.value = {};
      return;
    }
    const matches = await keyOutputsStore.loadRunMatches(props.labId, runId);
    const next: Record<string, number> = {};
    for (const role of matches?.KeyOutputs ?? []) {
      next[role.Pattern] = role.MatchCount;
    }
    matchCountByPattern.value = next;
  }

  watch(
    () => [props.sourceRunId, props.fallbackRunId, props.labId] as const,
    () => {
      void loadMatchCounts();
    },
    { immediate: true },
  );

  const hasUnsavedChanges = computed(() => snapshot(draft.value) !== savedSnapshot.value);
  const saving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputs'));
  const canSave = computed(
    () => hasUnsavedChanges.value && !saving.value && draft.value.every((row) => row.Label.trim()),
  );

  function removeRow(keyOutputId: string): void {
    draft.value = draft.value.filter((row) => row.KeyOutputId !== keyOutputId);
  }

  function cancelChanges(): void {
    syncFromProps();
  }

  function patternPath(row: DraftRow): string {
    return row.Pattern;
  }

  function fileCountLabel(row: DraftRow): string {
    const matchCount = matchCountByPattern.value[row.Pattern];
    if (isWholeFolderPattern(row.Pattern)) {
      if (matchCount != null) {
        return `Folder · ${matchCount.toLocaleString()} ${matchCount === 1 ? 'file' : 'files'}`;
      }
      return 'Folder';
    }
    const multi = row.Pattern.includes('*') || /\{[^}]+\}/.test(row.Pattern);
    if (multi) {
      if (matchCount != null) {
        return `${matchCount.toLocaleString()} files, one per sample`;
      }
      return 'Multiple files, one per sample';
    }
    return '1 file';
  }

  async function save(): Promise<void> {
    if (!canSave.value) return;
    const saved = await keyOutputsStore.save(
      props.labId,
      props.workflowId,
      draft.value.map((row) => ({
        KeyOutputId: row.KeyOutputId,
        Label: row.Label.trim(),
        Description: row.Description.trim() || undefined,
        Pattern: row.Pattern.trim(),
        ExamplePath: row.ExamplePath,
      })),
      {
        WorkflowName: props.workflowName,
        Platform: props.platform,
        // Keep the run these patterns were marked from so file-count labels stay accurate.
        SourceRunId: props.sourceRunId || props.fallbackRunId,
      },
    );
    if (!saved) return;
    savedSnapshot.value = snapshot(draft.value);
    toast.success('Selected results saved.');
    emit('saved');
  }
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <p class="text-muted max-w-2xl text-sm">
        Every run of this workflow shows these under Selected results. To add more, open a run and use Mark results in
        All files.
      </p>
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        icon="i-heroicons-flag"
        :icon-right="false"
        label="Mark results in a run"
        @click="emit('markInRun')"
      />
    </div>

    <div v-if="draft.length === 0" class="stroke-light rounded-2xl border border-dashed bg-white p-8 text-center">
      <p class="text-muted text-sm">No selected results yet.</p>
      <EGButton class="mt-4" label="Mark results in a run" size="sm" @click="emit('markInRun')" />
    </div>

    <div v-else class="stroke-light rounded-2xl border border-solid bg-white px-5 py-2">
      <ul class="divide-stroke-light list-none divide-y" role="list">
        <li
          v-for="row in draft"
          :key="row.KeyOutputId"
          class="grid gap-3 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center"
        >
          <div class="min-w-0">
            <p class="break-all font-mono text-xs text-black">{{ patternPath(row) }}</p>
            <p class="text-muted mt-0.5 text-xs">{{ fileCountLabel(row) }}</p>
          </div>
          <EGFormGroup class="!mb-0" label="Name" :name="`label-${row.KeyOutputId}`">
            <UInput v-model="row.Label" :maxlength="WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH" placeholder="Name" />
          </EGFormGroup>
          <EGFormGroup class="!mb-0" label="Description (optional)" :name="`description-${row.KeyOutputId}`">
            <UInput
              v-model="row.Description"
              :maxlength="WORKFLOW_KEY_OUTPUT_DESCRIPTION_MAX_LENGTH"
              placeholder="Description"
            />
          </EGFormGroup>
          <button
            type="button"
            class="text-muted hover:text-alert-danger inline-flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg"
            :aria-label="`Remove ${row.Label || row.Pattern}`"
            @click="removeRow(row.KeyOutputId)"
          >
            <UIcon name="i-heroicons-x-mark" class="h-5 w-5" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <footer class="border-stroke-light mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p class="text-muted text-sm">
          {{ draft.length }} selected {{ draft.length === 1 ? 'result' : 'results' }} · Changes show on every run of
          this workflow, past runs included.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <EGButton
            v-if="hasUnsavedChanges"
            :variant="ButtonVariantEnum.enum.secondary"
            label="Cancel"
            :disabled="saving"
            @click="cancelChanges"
          />
          <!-- Pale primary when clean; solid primary when there are savable changes (EGButton disabled is grey). -->
          <button
            type="button"
            class="focus-visible:outline-primary-500 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed"
            :class="canSave ? 'bg-primary hover:bg-primary-dark' : 'bg-primary/40'"
            :disabled="!canSave"
            :aria-busy="saving"
            @click="save"
          >
            <span v-if="saving" class="inline-flex items-center gap-2">
              <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin" aria-hidden="true" />
              Save
            </span>
            <span v-else>Save</span>
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
