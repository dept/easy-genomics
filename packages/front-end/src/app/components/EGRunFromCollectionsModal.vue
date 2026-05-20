<script setup lang="ts">
  import { z } from 'zod';
  import { v4 as uuidv4 } from 'uuid';
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
  import {
    useLabsStore,
    useOmicsWorkflowsStore,
    useRunStore,
    useSeqeraPipelinesStore,
    useToastStore,
    useUiStore,
    useUserStore,
  } from '@FE/stores';
  import { buildUploadedFilePairsFromKeys } from '@FE/utils/data-collections-to-sample-sheet';
  import { buildSampleSheetFileName } from '@FE/utils/sample-sheet-utils';

  export type RunFromCollectionsTagRow = { tagId: string; count: number; name: string; kind?: string };

  export type WorkflowPickerOption = {
    key: string;
    id: string;
    label: string;
    platform: RunType;
    description?: string;
  };

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    selectedKeys: string[];
    tagsOnSelection: RunFromCollectionsTagRow[];
    batchNamesSummary: string;
    neverAnalyzedCount: number;
    previouslyAnalyzedCount: number;
    listingTruncated: boolean;
    tagById: (tagId: string) => LaboratoryDataTag | undefined;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
  }>();

  const { $api } = useNuxtApp();
  const runStore = useRunStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();
  const seqeraPipelinesStore = useSeqeraPipelinesStore();
  const userStore = useUserStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const runName = ref('');
  const selectedWorkflowKey = ref<string | undefined>(undefined);
  const isContinuing = ref(false);
  const loadError = ref<string | null>(null);

  const MAX_RUN_NAME_LENGTH_OMICS = 124;
  const MAX_RUN_NAME_LENGTH_SEQERA = 50;

  const omicsAvailable = computed(() => !!props.lab?.AwsHealthOmicsEnabled);
  const seqeraAvailable = computed(() => !!props.lab?.NextFlowTowerEnabled && !!props.lab?.HasNextFlowTowerAccessToken);
  const anyPlatformAvailable = computed(() => omicsAvailable.value || seqeraAvailable.value);

  const workflowOptions = computed<WorkflowPickerOption[]>(() => {
    const options: WorkflowPickerOption[] = [];
    if (omicsAvailable.value) {
      for (const w of omicsWorkflowsStore.workflowsForLab(props.labId)) {
        if (!w.id) continue;
        options.push({
          key: `AWS HealthOmics:${w.id}`,
          id: w.id,
          label: w.name || w.id,
          platform: 'AWS HealthOmics',
          description: w.description,
        });
      }
    }
    if (seqeraAvailable.value) {
      for (const p of seqeraPipelinesStore.pipelinesForLab(props.labId)) {
        if (p.pipelineId == null) continue;
        options.push({
          key: `Seqera Cloud:${p.pipelineId}`,
          id: String(p.pipelineId),
          label: p.name || String(p.pipelineId),
          platform: 'Seqera Cloud',
          description: p.description,
        });
      }
    }
    return options.sort((a, b) => {
      if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
      return a.label.localeCompare(b.label);
    });
  });

  const selectedWorkflow = computed(() => workflowOptions.value.find((o) => o.key === selectedWorkflowKey.value));

  const isOmicsSelected = computed(() => selectedWorkflow.value?.platform === 'AWS HealthOmics');

  const runNameError = computed(() => {
    const name = runName.value;
    if (!name.trim()) return 'Run name is required.';
    if (isOmicsSelected.value) {
      const schema = z
        .string()
        .min(1)
        .max(MAX_RUN_NAME_LENGTH_OMICS)
        .refine((v) => !v.startsWith(' '), 'Run name cannot start with a space');
      const r = schema.safeParse(name);
      return r.success ? null : (r.error.errors[0]?.message ?? 'Invalid run name');
    }
    const schema = z.string().trim().min(1).max(MAX_RUN_NAME_LENGTH_SEQERA);
    const r = schema.safeParse(name);
    return r.success ? null : (r.error.errors[0]?.message ?? 'Invalid run name');
  });

  const canContinue = computed(
    () =>
      !!selectedWorkflow.value &&
      !runNameError.value &&
      !isContinuing.value &&
      !loadError.value &&
      props.selectedKeys.length > 0 &&
      anyPlatformAvailable.value,
  );

  watch(
    () => props.modelValue,
    async (open) => {
      if (!open) return;
      runName.value = '';
      selectedWorkflowKey.value = undefined;
      loadError.value = null;
      isContinuing.value = false;
      await loadWorkflowLists();
    },
  );

  async function loadWorkflowLists(): Promise<void> {
    loadError.value = null;
    uiStore.setRequestPending('runFromCollectionsWorkflows');
    try {
      const tasks: Promise<void>[] = [];
      if (omicsAvailable.value) {
        tasks.push(omicsWorkflowsStore.loadWorkflowsForLab(props.labId));
      }
      if (seqeraAvailable.value) {
        tasks.push(seqeraPipelinesStore.loadPipelinesForLab(props.labId));
      }
      await Promise.all(tasks);
      if (!workflowOptions.value.length) {
        loadError.value = 'No workflows or pipelines are available for this laboratory.';
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      loadError.value = `Failed to load workflows: ${msg}`;
    } finally {
      uiStore.setRequestComplete('runFromCollectionsWorkflows');
    }
  }

  function close(): void {
    emit('update:modelValue', false);
  }

  async function continueToRunSetup(): Promise<void> {
    const workflow = selectedWorkflow.value;
    if (!workflow || runNameError.value || !props.lab?.S3Bucket) return;

    isContinuing.value = true;
    const tempId = uuidv4();
    const sampleIdSplitPattern = userStore.currentUserDetails.sampleIdSplitPattern ?? null;

    try {
      const pairing = buildUploadedFilePairsFromKeys(
        props.selectedKeys,
        props.lab.S3Bucket,
        undefined,
        sampleIdSplitPattern,
      );
      if (!pairing.ok) {
        toast.error(pairing.message);
        return;
      }

      const sampleSheetName = buildSampleSheetFileName(runName.value);

      const sampleSheetResponse = await $api.uploads.getSampleSheetCsv(
        {
          SampleSheetName: sampleSheetName,
          LaboratoryId: props.labId,
          TransactionId: tempId,
          Platform: workflow.platform,
          UploadedFilePairs: pairing.pairs,
        },
        true,
      );

      const { S3Url, Bucket, Path } = sampleSheetResponse.SampleSheetInfo;

      const wipSeed = {
        transactionId: tempId,
        runName: runName.value.trim(),
        sampleSheetS3Url: S3Url,
        s3Bucket: Bucket,
        s3Path: Path,
        inputFileKeys: [...props.selectedKeys],
        paramsRequired: [] as string[],
      };
      const paramSeed = {
        input: S3Url,
        outdir: `s3://${Bucket}/${Path}/results`,
      };

      if (workflow.platform === 'AWS HealthOmics') {
        runStore.updateWipOmicsRun(tempId, wipSeed);
        runStore.updateWipOmicsRunParams(tempId, paramSeed);
        const url = `/labs/${props.labId}/run-workflow/${workflow.id}?omicsRunTempId=${tempId}&from=data-collections`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        runStore.updateWipSeqeraRun(tempId, wipSeed);
        runStore.updateWipSeqeraRunParams(tempId, paramSeed);
        const url = `/labs/${props.labId}/run-pipeline/${workflow.id}?seqeraRunTempId=${tempId}&from=data-collections`;
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      close();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Could not prepare run: ${msg}`);
    } finally {
      isContinuing.value = false;
    }
  }
</script>

<template>
  <UModal
    :model-value="modelValue"
    :ui="{
      overlay: {
        base: 'fixed inset-0 transition-opacity backdrop-blur-[5px]',
        background: 'bg-gray-800/30',
      },
      rounded: 'rounded-3xl',
      width: 'sm:max-w-lg',
    }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <UCard
      :ui="{
        base: 'p-8',
        rounded: 'rounded-3xl',
        header: { padding: '' },
      }"
    >
      <template #header>
        <div class="flex flex-col gap-1">
          <h3 class="text-lg font-semibold text-gray-900">Run workflow</h3>
          <p class="text-muted text-sm">
            Choose a workflow or pipeline and continue to run setup with your selected files.
          </p>
        </div>
      </template>

      <div v-if="!anyPlatformAvailable" class="text-muted text-sm">
        This laboratory does not have AWS HealthOmics or Seqera Cloud enabled. Configure a platform in lab settings to
        run workflows.
      </div>

      <div v-else class="space-y-4">
        <div
          v-if="listingTruncated"
          class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          The file listing may be incomplete. Confirm your selection includes all intended samples.
        </div>

        <div class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">Selected files</dt>
              <dd class="font-medium tabular-nums">{{ selectedKeys.length }}</dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted shrink-0 pt-0.5">Batch(es)</dt>
              <dd class="min-w-0 flex-1 break-words text-right font-medium leading-snug">{{ batchNamesSummary }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">Never analyzed</dt>
              <dd class="font-medium tabular-nums">{{ neverAnalyzedCount }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted shrink-0">Previously analyzed</dt>
              <dd class="font-medium tabular-nums">{{ previouslyAnalyzedCount }}</dd>
            </div>
          </dl>
        </div>

        <div v-if="tagsOnSelection.length">
          <p class="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Tags on selection</p>
          <ul class="max-h-28 space-y-1 overflow-y-auto text-sm">
            <li
              v-for="row in tagsOnSelection"
              :key="row.tagId"
              class="flex items-center justify-between gap-2 rounded border border-gray-100 bg-white px-2 py-1"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="inline-block h-2 w-2 shrink-0 rounded-full"
                  :style="{ background: tagById(row.tagId)?.ColorHex || '#ccc' }"
                />
                <span class="truncate">{{ row.name }}</span>
              </span>
              <span class="text-muted shrink-0 text-xs tabular-nums">{{ row.count }}/{{ selectedKeys.length }}</span>
            </li>
          </ul>
        </div>

        <div v-if="uiStore.isRequestPending('runFromCollectionsWorkflows')" class="flex justify-center py-6">
          <UIcon name="i-heroicons-arrow-path" class="text-muted h-8 w-8 animate-spin" />
        </div>

        <p v-else-if="loadError" class="text-alert-danger-dark text-sm">{{ loadError }}</p>

        <template v-else>
          <div>
            <label class="text-muted mb-1 block text-xs font-semibold uppercase tracking-wide">
              Workflow / pipeline
            </label>
            <USelectMenu
              v-model="selectedWorkflowKey"
              :options="workflowOptions"
              option-attribute="label"
              value-attribute="key"
              placeholder="Select workflow or pipeline"
              size="sm"
              class="w-full"
              :disabled="isContinuing"
            />
            <p v-if="!workflowOptions.length" class="text-muted mt-1 text-xs">No workflows or pipelines found.</p>
          </div>

          <div>
            <label class="text-muted mb-1 block text-xs font-semibold uppercase tracking-wide">Run name</label>
            <UInput
              v-model="runName"
              placeholder="e.g. Nov-2024-panel-run"
              size="sm"
              class="w-full"
              :disabled="isContinuing"
            />
            <p v-if="runNameError && runName.length" class="text-alert-danger-dark mt-1 text-xs">{{ runNameError }}</p>
            <p v-else class="text-muted mt-1 text-xs">
              {{
                isOmicsSelected
                  ? 'AWS HealthOmics run names can include symbols and numbers, but cannot start with a space.'
                  : 'Alphanumeric characters, hyphens, and underscores; first character must be a letter.'
              }}
            </p>
          </div>
        </template>
      </div>

      <div class="mt-8 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
        <UButton size="sm" variant="ghost" :disabled="isContinuing" @click="close">Cancel</UButton>
        <UButton size="sm" :loading="isContinuing" :disabled="!canContinue" @click="continueToRunSetup">
          Continue to run setup
        </UButton>
      </div>
    </UCard>
  </UModal>
</template>
