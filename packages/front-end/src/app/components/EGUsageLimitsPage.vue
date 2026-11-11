<script setup lang="ts">
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    draftToRunLimits,
    formatRunLimit,
    runLimitsDraftError,
    runLimitsToDraft,
    usageLimitsNote,
    type RunLimitField,
    type RunLimitsDraft,
  } from '@FE/utils/usage-limits-form';

  const props = withDefaults(
    defineProps<{
      orgId: string;
      headingId?: string;
    }>(),
    {
      headingId: 'usage-limits-heading',
    },
  );

  const labsStore = useLabsStore();

  const isLoading = ref(true);
  const isSaving = ref(false);
  const editingLabId = ref<string | null>(null);
  const draft = ref<RunLimitsDraft>(runLimitsToDraft(undefined));
  const savedLabId = ref<string | null>(null);

  const LIMIT_COLUMNS: { field: RunLimitField; kind: 'usd' | 'count'; label: string }[] = [
    { field: 'CostWarnAboveUsd', kind: 'usd', label: 'Cost warn above' },
    { field: 'CostBlockAboveUsd', kind: 'usd', label: 'Cost block above' },
    { field: 'SamplesWarnAbove', kind: 'count', label: 'Samples warn above' },
    { field: 'SamplesBlockAbove', kind: 'count', label: 'Samples block above' },
  ];

  const labs = computed<Laboratory[]>(() =>
    [...labsStore.labsForOrg(props.orgId)].sort((labA, labB) => labA.Name.localeCompare(labB.Name)),
  );
  const editingLabName = computed<string | null>(
    () => labs.value.find((lab) => lab.LaboratoryId === editingLabId.value)?.Name ?? null,
  );
  const draftError = computed(() => (editingLabId.value ? runLimitsDraftError(draft.value) : null));
  const note = computed(() => usageLimitsNote(editingLabName.value, draftError.value));

  // The store is persisted, so always fetch: a stale localStorage copy must not be what the admin edits.
  onMounted(async () => {
    isLoading.value = true;
    await labsStore.loadLabsForOrg(props.orgId);
    isLoading.value = false;
  });

  function startEdit(lab: Laboratory) {
    savedLabId.value = null;
    draft.value = runLimitsToDraft(lab.RunLimits);
    editingLabId.value = lab.LaboratoryId;
  }

  function cancelEdit() {
    editingLabId.value = null;
    draft.value = runLimitsToDraft(undefined);
  }

  async function save() {
    const labId = editingLabId.value;
    if (!labId || draftError.value) return;

    isSaving.value = true;
    const saved = await labsStore.updateRunLimits(labId, draftToRunLimits(draft.value));
    isSaving.value = false;

    if (saved) {
      editingLabId.value = null;
      savedLabId.value = labId;
    }
  }

  function setDraftField(field: RunLimitField, value: unknown) {
    draft.value[field] = String(value ?? '');
  }
</script>

<template>
  <div :aria-busy="isLoading || isSaving" class="flex flex-col gap-6">
    <div>
      <EGText :id="props.headingId" tag="h3" class="mb-2">Usage limits</EGText>
      <p class="text-muted max-w-3xl text-sm">
        Set how much a single run can cost, and how many samples it can include, for each lab. If a run goes over,
        technicians are warned or stopped on the review step before it starts. Only organization admins can change
        these, and any amount can be left blank.
      </p>
    </div>

    <section class="border-background-dark-grey rounded-xl border bg-white p-6" aria-labelledby="usage-limits-by-lab">
      <EGText id="usage-limits-by-lab" tag="h3" class="mb-1">Limits by lab</EGText>
      <p class="text-muted mb-4 text-sm">
        Set a cost limit, a sample limit, or both. Leave the ones a lab doesn't need blank.
      </p>

      <div v-if="isLoading" class="flex justify-center py-10">
        <EGLoadingSpinner />
      </div>

      <p v-else-if="labs.length === 0" class="text-muted py-6 text-sm">There are no labs in this organization yet.</p>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-muted text-xs">
              <tr>
                <th scope="col" rowspan="2" class="px-3 py-2 font-semibold">Lab</th>
                <th scope="colgroup" colspan="2" class="px-3 pt-2 font-semibold">
                  <span class="inline-flex items-center gap-1">
                    Estimated cost per run
                    <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                      <template #text>
                        <p>
                          Checked against the run's estimate. A workflow needs a few finished runs in a lab before it
                          has one, so until then only sample limits apply.
                        </p>
                      </template>
                      <button type="button" aria-label="About estimated cost" class="inline-flex">
                        <UIcon name="i-heroicons-information-circle" class="text-muted h-4 w-4 shrink-0" />
                      </button>
                    </UTooltip>
                  </span>
                </th>
                <th scope="colgroup" colspan="2" class="px-3 pt-2 font-semibold">Samples per run</th>
                <th scope="col" rowspan="2" class="px-3 py-2"><span class="sr-only">Actions</span></th>
              </tr>
              <tr>
                <th scope="col" class="px-3 pb-2 font-normal">
                  <span class="inline-flex items-center gap-1">
                    Warn above
                    <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                      <template #text>
                        <p>Technicians see a warning on the review step and can still launch.</p>
                      </template>
                      <button type="button" aria-label="About warn" class="inline-flex">
                        <UIcon name="i-heroicons-information-circle" class="text-muted h-4 w-4 shrink-0" />
                      </button>
                    </UTooltip>
                  </span>
                </th>
                <th scope="col" class="px-3 pb-2 font-normal">
                  <span class="inline-flex items-center gap-1">
                    Block above
                    <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                      <template #text>
                        <p>The run can't be launched. Runs already going are never stopped.</p>
                      </template>
                      <button type="button" aria-label="About block" class="inline-flex">
                        <UIcon name="i-heroicons-information-circle" class="text-muted h-4 w-4 shrink-0" />
                      </button>
                    </UTooltip>
                  </span>
                </th>
                <th scope="col" class="px-3 pb-2 font-normal">Warn above</th>
                <th scope="col" class="px-3 pb-2 font-normal">Block above</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="lab in labs" :key="lab.LaboratoryId" class="border-background-dark-grey border-t">
                <th scope="row" class="px-3 py-3 font-medium">
                  <span class="inline-flex items-center gap-2">
                    {{ lab.Name }}
                    <span
                      v-if="savedLabId === lab.LaboratoryId"
                      class="bg-alert-success-muted text-alert-success-text rounded-full px-2 py-0.5 text-xs"
                    >
                      Saved
                    </span>
                  </span>
                </th>

                <template v-if="editingLabId === lab.LaboratoryId">
                  <td v-for="column in LIMIT_COLUMNS" :key="column.field" class="px-3 py-2">
                    <UInput
                      type="number"
                      min="0"
                      :step="column.kind === 'usd' ? '0.01' : '1'"
                      placeholder="Not set"
                      :aria-label="column.label"
                      :model-value="draft[column.field]"
                      :color="draftError?.field === column.field ? 'red' : undefined"
                      @update:model-value="(value: unknown) => setDraftField(column.field, value)"
                    >
                      <template v-if="column.kind === 'usd'" #leading>
                        <span class="text-muted text-xs">US$</span>
                      </template>
                    </UInput>
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end gap-2">
                      <EGButton
                        u-button-type="button"
                        size="sm"
                        variant="secondary"
                        label="Cancel"
                        :disabled="isSaving"
                        @click="cancelEdit"
                      />
                      <EGButton
                        u-button-type="button"
                        size="sm"
                        label="Save"
                        :disabled="!!draftError || isSaving"
                        :loading="isSaving"
                        @click="save"
                      />
                    </div>
                  </td>
                </template>

                <template v-else>
                  <td
                    v-for="column in LIMIT_COLUMNS"
                    :key="column.field"
                    class="px-3 py-3"
                    :class="{ 'text-muted': lab.RunLimits?.[column.field] === undefined }"
                  >
                    {{ formatRunLimit(lab.RunLimits?.[column.field], column.kind) }}
                  </td>
                  <td class="px-3 py-3">
                    <div class="flex justify-end">
                      <EGButton
                        u-button-type="button"
                        size="sm"
                        variant="secondary"
                        label="Edit"
                        :aria-label="`Edit limits for ${lab.Name}`"
                        :disabled="editingLabId !== null || isSaving"
                        @click="startEdit(lab)"
                      />
                    </div>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          class="mt-4 text-sm"
          :class="draftError ? 'text-alert-danger' : 'text-muted'"
          aria-live="polite"
          data-testid="usage-limits-note"
        >
          {{ note }}
        </p>
      </template>
    </section>
  </div>
</template>
