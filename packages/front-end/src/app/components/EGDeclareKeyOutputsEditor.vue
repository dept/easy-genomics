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
    run: LaboratoryRun;
  }>();

  const emit = defineEmits<{
    cancel: [];
    saved: [];
  }>();

  const titleId = useId();
  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const uiStore = useUiStore();
  const toast = useToastStore();

  const workflowId = computed(() => props.run.WorkflowExternalId || '');
  const workflowLabel = computed(() => props.run.WorkflowName?.trim() || 'this workflow');

  const draft = ref<PreviewWorkflowKeyOutput[]>([]);
  const groups = ref<RunWorkflowKeyOutputGroup[]>([]);
  const totalFileCount = ref(0);
  const searchQuery = ref('');
  const jsonText = ref(formatKeyOutputsJson([]));
  const jsonError = ref<string | null>(null);
  const jsonOpen = ref(false);
  const isLoading = ref(false);
  const isPreviewing = ref(false);

  const saving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputs'));
  const finishedAt = computed(() => {
    const stamp = props.run.TerminalAt || props.run.ModifiedAt;
    if (!stamp) return '';
    const date = parseISO(stamp);
    return isValid(date) ? format(date, 'MM/dd/yyyy') : '';
  });
  const selectedCountLabel = computed(() =>
    draft.value.length === 1 ? '1 selected' : `${draft.value.length} selected`,
  );
  const visibleGroups = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return groups.value;
    return groups.value.filter((group) => {
      const haystack = `${group.Directory} ${group.ExamplePath} ${group.Pattern} ${group.Label}`.toLowerCase();
      return haystack.includes(query);
    });
  });

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
    if (group.MatchCount === 1) return `${sizeLabel} · single file`;
    return `${sizeLabel} · ${group.MatchCount.toLocaleString()} similar files in this run`;
  }

  function directoryLabel(directory: string): string {
    if (!directory) return '';
    return directory.endsWith('/') ? directory : `${directory}/`;
  }

  async function scoreDraft(nextDraft: PreviewWorkflowKeyOutput[]): Promise<void> {
    if (nextDraft.length === 0) {
      draft.value = [];
      syncJsonFromDraft();
      return;
    }
    isPreviewing.value = true;
    try {
      const scored = await keyOutputsStore.preview(props.labId, props.run.RunId, { KeyOutputs: nextDraft });
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
    if (!workflowId.value) return;
    jsonOpen.value = false;
    isLoading.value = true;
    try {
      const runData = await keyOutputsStore.loadRunMatches(props.labId, props.run.RunId);
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
        const definition = await keyOutputsStore.load(props.labId, workflowId.value);
        draft.value = (definition?.KeyOutputs ?? []).map((item) => ({
          ...item,
          MatchCount: groups.value.find((group) => group.Pattern === item.Pattern)?.MatchCount ?? 0,
        }));
      }
      syncJsonFromDraft();
    } finally {
      isLoading.value = false;
    }
  }

  async function save(): Promise<void> {
    if (!workflowId.value) return;
    const parsed = parseKeyOutputsJson(jsonText.value);
    if (!parsed.ok) {
      jsonOpen.value = true;
      jsonError.value = parsed.error;
      return;
    }
    const saved = await keyOutputsStore.save(
      props.labId,
      workflowId.value,
      parsed.outputs.map((item) => ({
        Label: item.Label.trim(),
        Pattern: item.Pattern.trim(),
        ExamplePath: item.ExamplePath,
      })),
      {
        WorkflowName: props.run.WorkflowName,
        Platform: props.run.Platform,
        SourceRunId: props.run.RunId,
      },
    );
    if (!saved) return;
    toast.success(`Key outputs saved for ${workflowLabel.value}.`);
    emit('saved');
  }

  function matchCountLabel(count: number): string {
    return count === 1 ? '1 file on this run' : `${count} files on this run`;
  }

  onMounted(() => {
    void loadEditor();
  });
</script>

<template>
  <section :aria-labelledby="titleId">
    <header class="mb-6">
      <EGText :id="titleId" tag="h3">Key outputs for {{ workflowLabel }}</EGText>
      <p class="text-muted mt-2 max-w-3xl text-sm">
        Applies to every run of this workflow in {{ labName || 'this laboratory' }}. Pick from a completed run and we
        will work out the pattern that matches the same file in future runs.
      </p>
      <dl class="mt-5 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <dt class="text-muted text-xs font-medium uppercase tracking-wide">Picking from</dt>
          <dd class="text-heading mt-1 text-sm font-medium">{{ run.RunName }}</dd>
        </div>
        <div v-if="finishedAt">
          <dt class="text-muted text-xs font-medium uppercase tracking-wide">Finished</dt>
          <dd class="text-heading mt-1 text-sm font-medium">{{ finishedAt }}</dd>
        </div>
        <div>
          <dt class="text-muted text-xs font-medium uppercase tracking-wide">Objects</dt>
          <dd class="text-heading mt-1 text-sm font-medium">{{ totalFileCount.toLocaleString() }}</dd>
        </div>
      </dl>
    </header>

    <div v-if="!workflowId" class="text-muted rounded-2xl border border-dashed p-6 text-sm">
      This run has no workflow id, so key outputs cannot be saved for future runs.
    </div>

    <div v-else class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <section class="overflow-hidden rounded-2xl border border-neutral-200 bg-white" aria-label="Files from this run">
        <header
          class="bg-background-light-grey flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3"
        >
          <EGText tag="h4">Files from this run</EGText>
          <p class="text-muted text-xs">one example per group shown</p>
        </header>
        <div class="p-5 lg:max-h-[36rem] lg:overflow-y-auto">
          <EGSearchInput
            label="Search file groups"
            placeholder="Search files from this run"
            class="mb-4 w-full"
            @input-event="(value: string) => (searchQuery = value)"
          />
          <p v-if="isLoading" class="text-muted text-sm">Loading files from this run…</p>
          <p v-else-if="visibleGroups.length === 0" class="text-muted text-sm">No file groups match that search.</p>
          <ul v-else class="divide-y divide-neutral-200" role="list">
            <li v-for="group in visibleGroups" :key="group.Pattern" class="py-3 first:pt-0">
              <label class="flex cursor-pointer items-start gap-3">
                <UCheckbox
                  class="mt-1"
                  :model-value="isSelected(group.Pattern)"
                  :label="`Select ${basenameRelative(group.ExamplePath)} as a key output`"
                  :ui="{ label: 'sr-only' }"
                  @update:model-value="toggleGroup(group)"
                />
                <span class="min-w-0 flex-1">
                  <span v-if="group.Directory" class="text-muted block font-mono text-xs">
                    {{ directoryLabel(group.Directory) }}
                  </span>
                  <span class="text-heading block text-sm font-medium">
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
        <section class="overflow-hidden rounded-2xl border border-neutral-200 bg-white" aria-label="Key outputs">
          <header
            class="bg-background-light-grey flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3"
          >
            <EGText tag="h4">Key outputs</EGText>
            <p class="text-muted text-xs">{{ selectedCountLabel }}</p>
          </header>
          <div class="min-h-[12rem] p-5">
            <p v-if="isLoading" class="text-muted text-sm">Loading saved key outputs…</p>
            <p v-else-if="draft.length === 0" class="text-muted mx-auto max-w-xs py-8 text-center text-sm">
              Nothing selected yet. Tick a file on the left and it appears here as a key output.
            </p>
            <ul v-else class="space-y-4">
              <li v-for="item in draft" :key="item.Pattern">
                <div class="flex items-start justify-between gap-2">
                  <label class="min-w-0 flex-1">
                    <span class="sr-only">Role name</span>
                    <input
                      :value="item.Label"
                      class="text-heading w-full border-0 bg-transparent p-0 font-serif text-base font-semibold focus:ring-0"
                      @input="updateLabel(item.Pattern, ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                  <UButton
                    icon="i-heroicons-x-mark"
                    color="black"
                    variant="ghost"
                    :ui="{ rounded: 'rounded-full' }"
                    :aria-label="`Remove ${item.Label}`"
                    @click="removeOutput(item.Pattern)"
                  />
                </div>
                <p class="text-muted mt-1 break-all font-mono text-xs">{{ item.Pattern }}</p>
                <p class="text-primary mt-1 text-xs font-medium">
                  {{ isPreviewing ? 'Matching files…' : matchCountLabel(item.MatchCount) }}
                </p>
              </li>
            </ul>
          </div>
          <details
            class="border-t border-neutral-200 px-5 py-3"
            :open="jsonOpen"
            @toggle="jsonOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="text-primary cursor-pointer text-sm font-medium">Advanced — edit as JSON</summary>
            <p class="text-muted mt-2 text-xs">
              Escape hatch for bioinformaticians. The JSON is what a workflow author could ship alongside a pipeline so
              a lab starts with sensible defaults.
            </p>
            <textarea
              v-model="jsonText"
              class="mt-3 w-full rounded-xl border border-neutral-200 p-3 font-mono text-xs leading-5"
              rows="8"
              spellcheck="false"
              aria-label="Key outputs JSON"
              @blur="applyJson"
            />
            <p v-if="jsonError" class="text-alert-danger-dark mt-1.5 text-xs">{{ jsonError }}</p>
          </details>
        </section>

        <div class="mt-4 flex justify-end gap-3">
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            :variant="ButtonVariantEnum.enum.secondary"
            label="Cancel"
            :disabled="saving"
            @click="close"
          />
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            label="Save key outputs"
            :disabled="!workflowId || isLoading || saving"
            :loading="saving"
            @click="save"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
  summary::-webkit-details-marker {
    color: inherit;
  }
</style>
