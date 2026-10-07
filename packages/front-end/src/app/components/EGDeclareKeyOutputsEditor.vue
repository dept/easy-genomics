<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import type { PreviewWorkflowKeyOutput } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import {
    formatKeyOutputsJson,
    parseKeyOutputsJson,
  } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
  import { useDebounceFn } from '@vueuse/core';
  import { format, parseISO, isValid } from 'date-fns';
  import { v4 as uuidv4 } from 'uuid';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { useToastStore, useUiStore, useWorkflowKeyOutputsStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
    labName: string;
    run: LaboratoryRun;
    s3Bucket: string;
    s3Prefix: string;
    startPath?: string[] | null;
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
  const selectedKeys = ref<string[]>([]);
  const patternBySelectedKey = ref<Record<string, string>>({});
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

  function close(): void {
    if (saving.value) return;
    emit('cancel');
  }

  function syncJsonFromDraft(): void {
    jsonText.value = formatKeyOutputsJson(draft.value);
    jsonError.value = null;
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

  async function loadDefinition(): Promise<void> {
    if (!workflowId.value) return;
    selectedKeys.value = [];
    patternBySelectedKey.value = {};
    jsonOpen.value = false;
    isLoading.value = true;
    try {
      const definition = await keyOutputsStore.load(props.labId, workflowId.value);
      const loaded = (definition?.KeyOutputs ?? []).map((item) => ({
        ...item,
        MatchCount: 0,
      }));
      await scoreDraft(loaded);
    } finally {
      isLoading.value = false;
    }
  }

  onMounted(() => {
    void loadDefinition();
  });

  const onSelectionChange = useDebounceFn(async (nextKeys: string[]) => {
    const previous = new Set(Object.keys(patternBySelectedKey.value));
    const added = nextKeys.filter((key) => !previous.has(key));
    const removed = [...previous].filter((key) => !nextKeys.includes(key));

    if (added.length === 0 && removed.length === 0) return;

    let nextDraft = [...draft.value];

    if (removed.length > 0) {
      const removedPatterns = new Set(
        removed.map((key) => patternBySelectedKey.value[key]).filter((pattern): pattern is string => !!pattern),
      );
      const stillSelectedPatterns = new Set(
        nextKeys.map((key) => patternBySelectedKey.value[key]).filter((pattern): pattern is string => !!pattern),
      );
      nextDraft = nextDraft.filter(
        (item) => !removedPatterns.has(item.Pattern) || stillSelectedPatterns.has(item.Pattern),
      );
      const nextMap = { ...patternBySelectedKey.value };
      for (const key of removed) delete nextMap[key];
      patternBySelectedKey.value = nextMap;
    }

    if (added.length > 0) {
      isPreviewing.value = true;
      try {
        const inferred = await keyOutputsStore.preview(props.labId, props.run.RunId, { ObjectKeys: added });
        if (inferred) {
          const nextMap = { ...patternBySelectedKey.value };
          for (const key of added) {
            const match =
              inferred.find((item) => item.ExamplePath && key.endsWith(item.ExamplePath)) ??
              (inferred.length === 1 ? inferred[0] : undefined);
            if (match) nextMap[key] = match.Pattern;
          }
          for (const item of inferred) {
            if (!nextDraft.some((existing) => existing.Pattern === item.Pattern)) {
              nextDraft.push(item);
            }
          }
          patternBySelectedKey.value = nextMap;
        }
      } finally {
        isPreviewing.value = false;
      }
    }

    await scoreDraft(nextDraft);
  }, 250);

  watch(selectedKeys, (keys) => {
    void onSelectionChange(keys);
  });

  function removeOutput(pattern: string): void {
    draft.value = draft.value.filter((item) => item.Pattern !== pattern);
    const nextMap = { ...patternBySelectedKey.value };
    for (const [key, mapped] of Object.entries(nextMap)) {
      if (mapped === pattern) delete nextMap[key];
    }
    patternBySelectedKey.value = nextMap;
    selectedKeys.value = selectedKeys.value.filter((key) => patternBySelectedKey.value[key]);
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
</script>

<template>
  <section :aria-labelledby="titleId">
    <header class="mb-6">
      <EGText :id="titleId" tag="h3">Key outputs for {{ workflowLabel }}</EGText>
      <p class="text-muted mt-2 max-w-3xl text-sm">
        Applies to every run of this workflow in {{ labName || 'this laboratory' }}. Pick from a completed run and we
        will work out the pattern that matches the same file in future runs.
      </p>
      <p class="text-muted mt-3 text-sm">
        Picking from
        <span class="text-heading font-medium">{{ run.RunName }}</span>
        <span v-if="finishedAt">· Finished {{ finishedAt }}</span>
      </p>
      <p class="text-muted mt-4 max-w-3xl text-sm">
        The wildcard is inferred, not typed. Tick one sample's file and we generalise it to a pattern like
        <span class="font-mono text-xs">*.consensus.fa</span>
        and tell you how many files it matches. That is the step that makes the definition survive the next run.
      </p>
    </header>

    <div v-if="!workflowId" class="text-muted rounded-2xl border border-dashed p-6 text-sm">
      This run has no workflow id, so key outputs cannot be saved for future runs.
    </div>

    <div v-else class="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div class="grid grid-cols-1 lg:min-h-[28rem] lg:grid-cols-2">
        <div class="border-neutral-200 p-4 lg:max-h-[36rem] lg:overflow-y-auto lg:border-r">
          <EGFileExplorer
            :lab-id="labId"
            :run-id="run.RunId"
            :s3-bucket="s3Bucket"
            :s3-prefix="s3Prefix"
            :start-path="startPath ?? undefined"
            selection-mode
            v-model:selected-keys="selectedKeys"
          />
        </div>

        <div class="bg-primary-muted p-4 lg:max-h-[36rem] lg:overflow-y-auto">
          <p v-if="isLoading" class="text-muted text-sm">Loading saved key outputs…</p>
          <p v-else-if="draft.length === 0" class="text-muted text-sm">
            Tick and untick rows on the left. Each tick becomes a role — consensus genome, lineage assignment — not a
            list of sample files.
          </p>
          <ul v-else class="space-y-3">
            <li v-for="item in draft" :key="item.Pattern" class="rounded-xl bg-white p-4 shadow-sm">
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
              <p class="text-muted mt-2 break-all font-mono text-xs">{{ item.Pattern }}</p>
              <p class="text-primary mt-1 text-xs font-medium">
                {{ isPreviewing ? 'Matching files…' : matchCountLabel(item.MatchCount) }}
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <details
      v-if="workflowId"
      class="mt-6"
      :open="jsonOpen"
      @toggle="jsonOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="text-heading cursor-pointer text-sm font-medium">Edit as JSON</summary>
      <p class="text-muted mt-2 max-w-3xl text-xs">
        Escape hatch for bioinformaticians. The JSON is what a workflow author could ship alongside a pipeline so a lab
        starts with sensible defaults.
      </p>
      <textarea
        v-model="jsonText"
        class="mt-3 w-full rounded-xl border border-neutral-200 p-3 font-mono text-xs leading-5"
        rows="10"
        spellcheck="false"
        aria-label="Key outputs JSON"
        @blur="applyJson"
      />
      <p v-if="jsonError" class="text-alert-danger-dark mt-1.5 text-xs">{{ jsonError }}</p>
    </details>

    <div class="mt-8 flex justify-end gap-3">
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
  </section>
</template>
