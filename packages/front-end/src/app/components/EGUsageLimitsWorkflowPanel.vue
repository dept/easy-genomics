<script setup lang="ts">
  import {
    Laboratory,
    LaboratoryWorkflowCostRow,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { workflowRunLimitsKey } from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';
  import {
    draftToWorkflowRequest,
    isWorkflowDraftChanged,
    labAmountPlaceholder,
    typicalCostText,
    typicalCostTooltip,
    workflowDraftError,
    workflowLimitsToDraft,
    type WorkflowLimitsDraft,
  } from '@FE/utils/workflow-limits-form';

  const props = defineProps<{
    lab: Laboratory;
    loadState: 'loading' | 'loaded' | 'failed';
    disabled: boolean;
  }>();

  const emit = defineEmits<{ retry: [] }>();

  const labsStore = useLabsStore();

  const drafts = ref<Record<string, WorkflowLimitsDraft>>({});
  const savingKey = ref<string | null>(null);
  const savedKey = ref<string | null>(null);

  const rows = computed<LaboratoryWorkflowCostRow[]>(() => labsStore.workflowCostRows[props.lab.LaboratoryId] ?? []);

  const rowKey = (row: LaboratoryWorkflowCostRow) => workflowRunLimitsKey(row.Platform, row.WorkflowId);
  const draftFor = (row: LaboratoryWorkflowCostRow) => drafts.value[rowKey(row)] ?? workflowLimitsToDraft(row);
  // Reads lab.RunLimits on every render, so a lab save made while this panel is open applies straight away.
  const errorFor = (row: LaboratoryWorkflowCostRow) =>
    workflowDraftError(draftFor(row), props.lab.RunLimits, row.WorkflowName);

  const firstDraftError = computed<string | null>(() => {
    for (const row of rows.value) {
      const error = errorFor(row);
      if (error) return error;
    }
    return null;
  });

  watch(
    rows,
    (latestRows) => {
      drafts.value = Object.fromEntries(latestRows.map((row) => [rowKey(row), workflowLimitsToDraft(row)]));
    },
    { immediate: true },
  );

  function setDraftField(row: LaboratoryWorkflowCostRow, field: keyof WorkflowLimitsDraft, value: unknown) {
    savedKey.value = null;
    drafts.value[rowKey(row)] = { ...draftFor(row), [field]: String(value ?? '') };
  }

  function cancel(row: LaboratoryWorkflowCostRow) {
    drafts.value[rowKey(row)] = workflowLimitsToDraft(row);
  }

  async function save(row: LaboratoryWorkflowCostRow) {
    if (errorFor(row)) return;

    const key = rowKey(row);
    savingKey.value = key;
    const saved = await labsStore.updateWorkflowRunLimits(
      props.lab.LaboratoryId,
      draftToWorkflowRequest(row, draftFor(row)),
    );
    savingKey.value = null;

    if (saved) {
      savedKey.value = key;
    }
  }
</script>

<template>
  <div class="bg-background-light-grey px-3 py-3 pl-9" :aria-busy="loadState === 'loading' || savingKey !== null">
    <p class="text-muted mb-3 max-w-3xl text-sm">
      Some workflows always cost more. Give them their own cost limits so the lab's stay useful. Blank uses the lab's.
    </p>

    <div v-if="loadState === 'loading'" class="flex justify-center py-6">
      <EGLoadingSpinner label="Loading workflows" />
    </div>

    <div v-else-if="loadState === 'failed'" class="flex items-center gap-3 py-3 text-sm">
      <p class="text-alert-danger">This lab's workflows couldn't be loaded.</p>
      <EGButton u-button-type="button" size="sm" variant="secondary" label="Try again" @click="emit('retry')" />
    </div>

    <p v-else-if="rows.length === 0" class="text-muted py-3 text-sm">
      This lab hasn't run any workflows yet, so there's nothing to set a cost limit on.
    </p>

    <template v-else>
      <table class="w-full text-left text-sm">
        <thead class="sr-only">
          <tr>
            <th scope="col">Workflow</th>
            <th scope="col">Cost warn above</th>
            <th scope="col">Cost block above</th>
            <th scope="col">Sample limits</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="rowKey(row)"
            :class="{ 'border-background-dark-grey border-t': index > 0 }"
          >
            <th scope="row" class="px-3 py-2 font-normal">
              <div class="flex items-center gap-2">
                <span>
                  {{ row.WorkflowName }}
                  <span v-if="row.LatestVersionName" class="text-muted">{{ row.LatestVersionName }}</span>
                </span>
                <span
                  v-if="savedKey === rowKey(row)"
                  class="bg-alert-success-muted text-alert-success-text rounded-full px-2 py-0.5 text-xs"
                >
                  Saved
                </span>
              </div>
              <!-- The tooltip's own wrapper is inline, so this keeps the typical cost on its own line. -->
              <div class="mt-0.5">
                <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                  <template #text>
                    <p>{{ typicalCostTooltip(row) }}</p>
                  </template>
                  <button type="button" class="text-muted text-xs underline decoration-dotted">
                    {{ typicalCostText(row) }}
                  </button>
                </UTooltip>
              </div>
            </th>
            <td class="px-3 py-2">
              <UInput
                type="number"
                min="0"
                step="0.01"
                :placeholder="labAmountPlaceholder(lab.RunLimits?.CostWarnAboveUsd)"
                :aria-label="`Cost warn above for ${row.WorkflowName}`"
                :model-value="draftFor(row).CostWarnAboveUsd"
                :disabled="disabled || savingKey !== null"
                :color="errorFor(row) ? 'red' : undefined"
                @update:model-value="(value: unknown) => setDraftField(row, 'CostWarnAboveUsd', value)"
              >
                <template #leading>
                  <span class="text-muted text-xs">US$</span>
                </template>
              </UInput>
            </td>
            <td class="px-3 py-2">
              <UInput
                type="number"
                min="0"
                step="0.01"
                :placeholder="labAmountPlaceholder(lab.RunLimits?.CostBlockAboveUsd)"
                :aria-label="`Cost block above for ${row.WorkflowName}`"
                :model-value="draftFor(row).CostBlockAboveUsd"
                :disabled="disabled || savingKey !== null"
                :color="errorFor(row) ? 'red' : undefined"
                @update:model-value="(value: unknown) => setDraftField(row, 'CostBlockAboveUsd', value)"
              >
                <template #leading>
                  <span class="text-muted text-xs">US$</span>
                </template>
              </UInput>
            </td>
            <td class="text-muted px-3 py-2">Uses the lab's sample limits</td>
            <td class="px-3 py-2">
              <div v-if="isWorkflowDraftChanged(row, draftFor(row))" class="flex justify-end gap-2">
                <EGButton
                  u-button-type="button"
                  size="sm"
                  variant="secondary"
                  label="Cancel"
                  :disabled="savingKey !== null"
                  @click="cancel(row)"
                />
                <EGButton
                  u-button-type="button"
                  size="sm"
                  label="Save"
                  :disabled="!!errorFor(row) || disabled || savingKey !== null"
                  :loading="savingKey === rowKey(row)"
                  @click="save(row)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <p class="text-alert-danger mt-2 text-sm" aria-live="polite">{{ firstDraftError ?? '' }}</p>
  </div>
</template>
