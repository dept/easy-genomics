<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import type {
    PreviewWorkflowKeyOutput,
    RunWorkflowKeyOutputGroup,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import {
    basenameRelative,
    formatKeyOutputsJson,
    parseKeyOutputsJson,
  } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
  import { format, parseISO, isValid } from 'date-fns';
  import { v4 as uuidv4 } from 'uuid';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { formatFileSize } from '@FE/utils/file-size';
  import { useToastStore, useUiStore, useWorkflowKeyOutputsStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
    labName: string;
    /** Active run used to pick file groups. Required unless `availableRuns` supplies options. */
    run?: LaboratoryRun;
    /** Completed runs of this workflow; enables the pick-from-run dropdown. */
    availableRuns?: LaboratoryRun[];
    /** Hide the intro copy when the parent page already shows it. */
    hideIntro?: boolean;
  }>();

  const emit = defineEmits<{
    cancel: [];
    saved: [];
  }>();

  const titleId = useId();
  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const uiStore = useUiStore();
  const toast = useToastStore();

  const selectedRunId = ref('');
  const draft = ref<PreviewWorkflowKeyOutput[]>([]);
  const savedDraftSnapshot = ref('');
  const groups = ref<RunWorkflowKeyOutputGroup[]>([]);
  const totalFileCount = ref(0);
  const searchQuery = ref('');
  const jsonText = ref(formatKeyOutputsJson([]));
  const jsonError = ref<string | null>(null);
  const jsonOpen = ref(false);
  const isLoading = ref(false);
  const isPreviewing = ref(false);

  const runOptions = computed(() => {
    if (props.availableRuns?.length) return props.availableRuns;
    return props.run ? [props.run] : [];
  });

  const selectedRun = computed(
    () => runOptions.value.find((item) => item.RunId === selectedRunId.value) ?? runOptions.value[0] ?? null,
  );

  const showRunPicker = computed(() => (props.availableRuns?.length ?? 0) > 0);
  const workflowId = computed(() => selectedRun.value?.WorkflowExternalId || '');
  const workflowLabel = computed(() => selectedRun.value?.WorkflowName?.trim() || 'this workflow');
  const saving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputs'));
  const selectedCountLabel = computed(() => (draft.value.length === 1 ? '1 chosen' : `${draft.value.length} chosen`));
  const hasUnsavedChanges = computed(() => draftSnapshot(draft.value) !== savedDraftSnapshot.value);
  const canSave = computed(
    () => Boolean(workflowId.value) && !isLoading.value && !saving.value && hasUnsavedChanges.value,
  );

  const visibleGroups = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return groups.value;
    return groups.value.filter((group) => {
      const haystack = `${group.Directory} ${group.ExamplePath} ${group.Pattern} ${group.Label}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const runSelectOptions = computed(() =>
    runOptions.value.map((run) => ({
      label: formatRunOptionLabel(run),
      value: run.RunId,
    })),
  );

  function draftSnapshot(items: PreviewWorkflowKeyOutput[]): string {
    return JSON.stringify(
      items.map((item) => ({
        Label: item.Label.trim(),
        Pattern: item.Pattern.trim(),
        ExamplePath: item.ExamplePath ?? '',
      })),
    );
  }

  function finishedAtLabel(run: LaboratoryRun): string {
    const stamp = run.TerminalAt || run.ModifiedAt;
    if (!stamp) return '';
    const date = parseISO(stamp);
    return isValid(date) ? format(date, 'd MMM yyyy') : '';
  }

  function formatRunOptionLabel(run: LaboratoryRun): string {
    const finished = finishedAtLabel(run);
    return finished ? `${run.RunName} · completed ${finished}` : run.RunName;
  }

  function runByLabel(owner: string): string {
    const at = owner.indexOf('@');
    return at > 0 ? owner.slice(0, at) : owner;
  }

  function close(): void {
    if (saving.value) return;
    emit('cancel');
  }

  function syncJsonFromDraft(): void {
    jsonText.value = formatKeyOutputsJson(draft.value);
    jsonError.value = null;
  }

  function isSelected(pattern: string): boolean {
    return draft.value.some((item) => item.Pattern === pattern);
  }

  function similarFilesLabel(group: RunWorkflowKeyOutputGroup): string {
    const sizeLabel = formatFileSize(group.Size) || '0 B';
    if (group.MatchCount === 1) return `${sizeLabel} · 1 file`;
    return `${sizeLabel} · ${group.MatchCount.toLocaleString()} files`;
  }

  function directoryLabel(directory: string): string {
    if (!directory) return '';
    return directory.endsWith('/') ? directory : `${directory}/`;
  }

  function matchCountLabel(count: number): string {
    return count === 1 ? 'Matches 1 file in this run.' : `Matches ${count.toLocaleString()} files in this run.`;
  }

  async function scoreDraft(nextDraft: PreviewWorkflowKeyOutput[]): Promise<void> {
    if (!selectedRun.value) return;
    if (nextDraft.length === 0) {
      draft.value = [];
      syncJsonFromDraft();
      return;
    }
    isPreviewing.value = true;
    try {
      const scored = await keyOutputsStore.preview(props.labId, selectedRun.value.RunId, { KeyOutputs: nextDraft });
      draft.value = scored ?? nextDraft.map((item) => ({ ...item, MatchCount: item.MatchCount ?? 0 }));
      syncJsonFromDraft();
    } finally {
      isPreviewing.value = false;
    }
  }

  function toggleGroup(group: RunWorkflowKeyOutputGroup): void {
    if (isSelected(group.Pattern)) {
      draft.value = draft.value.filter((item) => item.Pattern !== group.Pattern);
      syncJsonFromDraft();
      return;
    }
    draft.value = [
      ...draft.value,
      {
        KeyOutputId: uuidv4(),
        Label: group.Label,
        Pattern: group.Pattern,
        ExamplePath: group.ExamplePath,
        MatchCount: group.MatchCount,
      },
    ];
    syncJsonFromDraft();
  }

  function removeOutput(pattern: string): void {
    draft.value = draft.value.filter((item) => item.Pattern !== pattern);
    syncJsonFromDraft();
  }

  function updateLabel(pattern: string, label: string): void {
    const item = draft.value.find((entry) => entry.Pattern === pattern);
    if (!item) return;
    item.Label = label;
    syncJsonFromDraft();
  }

  function applyJson(): void {
    const parsed = parseKeyOutputsJson(jsonText.value);
    if (!parsed.ok) {
      jsonError.value = parsed.error;
      return;
    }
    jsonError.value = null;
    const nextDraft: PreviewWorkflowKeyOutput[] = parsed.outputs.map((item) => ({
      KeyOutputId: uuidv4(),
      Label: item.Label,
      Pattern: item.Pattern,
      ExamplePath: item.ExamplePath,
      MatchCount: 0,
    }));
    void scoreDraft(nextDraft);
  }

  async function loadEditor(): Promise<void> {
    const run = selectedRun.value;
    if (!run?.WorkflowExternalId) {
      groups.value = [];
      totalFileCount.value = 0;
      draft.value = [];
      savedDraftSnapshot.value = draftSnapshot([]);
      syncJsonFromDraft();
      return;
    }

    jsonOpen.value = false;
    isLoading.value = true;
    try {
      const runData = await keyOutputsStore.loadRunMatches(props.labId, run.RunId);
      groups.value = runData?.Groups ?? [];
      totalFileCount.value = runData?.TotalFileCount ?? 0;
      draft.value = (runData?.KeyOutputs ?? []).map((item) => ({
        KeyOutputId: item.KeyOutputId,
        Label: item.Label,
        Pattern: item.Pattern,
        ExamplePath: item.ExamplePath,
        MatchCount: item.MatchCount,
      }));
      if (draft.value.length === 0) {
        const definition = await keyOutputsStore.load(props.labId, run.WorkflowExternalId);
        draft.value = (definition?.KeyOutputs ?? []).map((item) => ({
          ...item,
          MatchCount: groups.value.find((group) => group.Pattern === item.Pattern)?.MatchCount ?? 0,
        }));
      }
      savedDraftSnapshot.value = draftSnapshot(draft.value);
      syncJsonFromDraft();
    } finally {
      isLoading.value = false;
    }
  }

  async function save(): Promise<void> {
    const run = selectedRun.value;
    if (!run?.WorkflowExternalId || !canSave.value) return;
    const parsed = parseKeyOutputsJson(jsonText.value);
    if (!parsed.ok) {
      jsonOpen.value = true;
      jsonError.value = parsed.error;
      return;
    }
    const saved = await keyOutputsStore.save(
      props.labId,
      run.WorkflowExternalId,
      parsed.outputs.map((item) => ({
        Label: item.Label.trim(),
        Pattern: item.Pattern.trim(),
        ExamplePath: item.ExamplePath,
      })),
      {
        WorkflowName: run.WorkflowName,
        Platform: run.Platform,
        SourceRunId: run.RunId,
      },
    );
    if (!saved) return;
    savedDraftSnapshot.value = draftSnapshot(draft.value);
    toast.success(`Output files saved for ${workflowLabel.value}.`);
    emit('saved');
  }

  function ensureSelectedRun(): void {
    if (selectedRunId.value && runOptions.value.some((run) => run.RunId === selectedRunId.value)) return;
    selectedRunId.value = props.run?.RunId || runOptions.value[0]?.RunId || '';
  }

  // Register before the props watcher so the first selectedRunId assignment loads the editor.
  watch(selectedRunId, (runId, previousRunId) => {
    if (!runId || runId === previousRunId) return;
    void loadEditor();
  });

  watch(
    () => [props.run?.RunId, (props.availableRuns ?? []).map((run) => run.RunId).join(',')] as const,
    () => {
      ensureSelectedRun();
    },
    { immediate: true },
  );
</script>

<template>
  <section :aria-labelledby="titleId" class="w-full">
    <header v-if="!hideIntro" class="mb-6">
      <EGText :id="titleId" tag="h3" class="sr-only">Output files for {{ workflowLabel }}</EGText>
      <p class="text-muted max-w-3xl text-sm">
        Choose the files from this workflow that matter. Integrations send these files, and they&apos;re applied to
        every run of this workflow in {{ labName || 'this laboratory' }}. Pick from a completed run and we&apos;ll match
        the same file in future runs.
      </p>
    </header>
    <EGText v-else :id="titleId" tag="h3" class="sr-only">Output files for {{ workflowLabel }}</EGText>

    <div v-if="runOptions.length === 0" class="rounded-2xl border border-dashed border-neutral-200 bg-white p-6">
      <p class="text-muted text-sm">
        No completed run of this workflow was found. Finish a run first, then you can choose output files from its
        files.
      </p>
    </div>

    <template v-else>
      <div class="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-8">
          <div class="min-w-0 flex-1">
            <p class="text-muted mb-2 text-xs font-medium uppercase tracking-wide">Pick from run</p>
            <USelectMenu
              v-if="showRunPicker"
              v-model="selectedRunId"
              :options="runSelectOptions"
              value-attribute="value"
              option-attribute="label"
              :disabled="saving"
              class="w-full"
            />
            <p v-else class="text-heading text-sm font-medium">
              {{ selectedRun ? formatRunOptionLabel(selectedRun) : '' }}
            </p>
          </div>
          <dl class="flex flex-wrap gap-x-10 gap-y-3 lg:shrink-0">
            <div>
              <dt class="text-muted text-xs font-medium uppercase tracking-wide">Files in run</dt>
              <dd class="text-heading mt-1 text-sm font-medium">{{ totalFileCount.toLocaleString() }}</dd>
            </div>
            <div v-if="selectedRun?.Owner">
              <dt class="text-muted text-xs font-medium uppercase tracking-wide">Run by</dt>
              <dd class="text-heading mt-1 text-sm font-medium">{{ runByLabel(selectedRun.Owner) }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div v-if="!workflowId" class="text-muted rounded-2xl border border-dashed p-6 text-sm">
        This run has no workflow id, so output files cannot be saved for future runs.
      </div>

      <div v-else class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section class="overflow-hidden rounded-2xl border border-neutral-200 bg-white" aria-label="Files in this run">
          <header class="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
            <h4 class="text-heading text-base font-semibold">Files in this run</h4>
            <p class="text-muted text-xs">Similar files grouped</p>
          </header>
          <div class="p-5 lg:max-h-[36rem] lg:overflow-y-auto">
            <EGSearchInput
              label="Search files"
              placeholder="Search files"
              class="mb-4 w-full"
              @input-event="(value: string) => (searchQuery = value)"
            />
            <p v-if="isLoading" class="text-muted text-sm">Loading files from this run…</p>
            <p v-else-if="visibleGroups.length === 0" class="text-muted text-sm">No file groups match that search.</p>
            <ul v-else class="space-y-1" role="list">
              <li v-for="group in visibleGroups" :key="group.Pattern">
                <label
                  class="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors"
                  :class="isSelected(group.Pattern) ? 'bg-primary-muted' : 'hover:bg-background-light-grey'"
                >
                  <UCheckbox
                    class="mt-1"
                    :model-value="isSelected(group.Pattern)"
                    :label="`Select ${basenameRelative(group.ExamplePath)} as an output file`"
                    :ui="{ label: 'sr-only' }"
                    @update:model-value="toggleGroup(group)"
                  />
                  <span class="min-w-0 flex-1">
                    <span v-if="group.Directory" class="text-muted block font-mono text-xs">
                      {{ directoryLabel(group.Directory) }}
                    </span>
                    <span class="text-heading block text-sm font-semibold">
                      {{ basenameRelative(group.ExamplePath) }}
                    </span>
                    <span class="text-muted mt-0.5 block text-xs">{{ similarFilesLabel(group) }}</span>
                  </span>
                </label>
              </li>
            </ul>
          </div>
        </section>

        <div class="flex flex-col">
          <section
            class="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
            aria-label="Chosen output files"
          >
            <header class="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
              <h4 class="text-heading text-base font-semibold">Chosen output files</h4>
              <p class="text-muted text-xs">{{ selectedCountLabel }}</p>
            </header>
            <div class="min-h-[12rem] p-5">
              <p v-if="isLoading" class="text-muted text-sm">Loading saved output files…</p>
              <p v-else-if="draft.length === 0" class="text-muted mx-auto max-w-xs py-8 text-center text-sm">
                Nothing chosen yet. Tick a file on the left and it appears here.
              </p>
              <ul v-else class="space-y-3">
                <li v-for="item in draft" :key="item.Pattern" class="rounded-xl border border-neutral-200 bg-white p-4">
                  <div class="flex items-start gap-3">
                    <div
                      class="bg-background-light-grey text-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      aria-hidden="true"
                    >
                      <UIcon name="i-heroicons-document-text" class="h-5 w-5" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-2">
                        <label class="min-w-0 flex-1">
                          <span class="sr-only">Output file name</span>
                          <input
                            :value="item.Label"
                            class="text-heading w-full border-0 bg-transparent p-0 text-sm font-semibold focus:ring-0"
                            @input="updateLabel(item.Pattern, ($event.target as HTMLInputElement).value)"
                          />
                        </label>
                        <UButton
                          icon="i-heroicons-x-mark"
                          color="black"
                          variant="ghost"
                          size="xs"
                          :ui="{ rounded: 'rounded-full' }"
                          :aria-label="`Remove ${item.Label}`"
                          @click="removeOutput(item.Pattern)"
                        />
                      </div>
                      <p class="text-muted mt-1 break-all font-mono text-xs">
                        {{ item.ExamplePath || item.Pattern }}
                      </p>
                      <p class="text-alert-success-text mt-2 text-xs font-medium">
                        {{ isPreviewing ? 'Matching files…' : matchCountLabel(item.MatchCount) }}
                      </p>
                    </div>
                  </div>
                </li>
              </ul>

              <div class="mt-4">
                <button
                  type="button"
                  class="text-primary hover:text-primary-dark inline-flex items-center gap-1 text-sm font-medium"
                  @click="jsonOpen = !jsonOpen"
                >
                  <UIcon
                    :name="jsonOpen ? 'i-heroicons-chevron-down' : 'i-heroicons-play-solid'"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  Edit as JSON
                </button>
                <div v-if="jsonOpen" class="mt-3">
                  <textarea
                    v-model="jsonText"
                    class="w-full rounded-xl border border-neutral-200 p-3 font-mono text-xs leading-5"
                    rows="8"
                    spellcheck="false"
                    aria-label="Output files JSON"
                    @blur="applyJson"
                  />
                  <p v-if="jsonError" class="text-alert-danger-dark mt-1.5 text-xs">{{ jsonError }}</p>
                </div>
              </div>

              <p class="text-muted mt-5 text-xs">Used by Copy to S3 on this workflow.</p>
            </div>
          </section>

          <div class="mt-4 flex flex-wrap gap-3">
            <EGButton
              :size="ButtonSizeEnum.enum.sm"
              label="Save output files"
              :disabled="!canSave"
              :loading="saving"
              @click="save"
            />
            <EGButton
              :size="ButtonSizeEnum.enum.sm"
              :variant="ButtonVariantEnum.enum.secondary"
              label="Cancel"
              :disabled="saving"
              @click="close"
            />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
