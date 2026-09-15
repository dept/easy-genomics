<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { SampleLayout } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import {
    REGEX_GROUPING_PRESETS,
    type RegexGroupingPresetKey,
  } from '@easy-genomics/shared-lib/src/app/utils/sample-regex-grouping';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { basenameFromS3Key } from '@FE/utils/data-collections-file-type';

  const props = defineProps<{
    modelValue: boolean;
    labId: string;
    lab: Laboratory | null;
    /** Full S3 object keys for unlinked files to group. */
    fileKeys: string[];
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    created: [];
  }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const step = ref(1);
  const presetKey = ref<RegexGroupingPresetKey>('underscore_r1_r2');
  const regexPattern = ref(REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern);
  const fileKeys = toRef(props, 'fileKeys');
  const { proposedSets, unmatchedFiles, refreshPreview } = useRegexGroupingPreview(fileKeys, regexPattern);
  const excludedSamples = ref<Set<string>>(new Set());
  const submitting = ref(false);

  watch(
    () => props.modelValue,
    (open) => {
      if (!open) return;
      step.value = 1;
      presetKey.value = 'underscore_r1_r2';
      regexPattern.value = REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern;
      excludedSamples.value = new Set();
      refreshPreview();
    },
  );

  watch(presetKey, (k) => {
    regexPattern.value = REGEX_GROUPING_PRESETS[k].pattern;
  });

  const activeSets = computed(() => proposedSets.value.filter((s) => !excludedSamples.value.has(s.sampleId)));

  const stats = computed(() => {
    const paired = activeSets.value.filter((s) => s.status === 'paired').length;
    const single = activeSets.value.filter((s) => s.status === 'single_end').length;
    const review = activeSets.value.filter((s) => s.status === 'needs_review').length;
    return { paired, single, review, total: activeSets.value.length };
  });

  function toggleExclude(sampleId: string): void {
    const next = new Set(excludedSamples.value);
    if (next.has(sampleId)) next.delete(sampleId);
    else next.add(sampleId);
    excludedSamples.value = next;
  }

  function close(): void {
    emit('update:modelValue', false);
  }

  async function confirmCreate(): Promise<void> {
    if (!activeSets.value.length) return;
    if (!props.lab?.S3Bucket) {
      toast.error('Laboratory S3 bucket is not configured');
      return;
    }

    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    const bucket = props.lab.S3Bucket;
    let created = 0;
    const failedSamples: string[] = [];

    try {
      // Create one set per request so a slow or failed bulk call cannot block the entire batch.
      for (const s of activeSets.value) {
        try {
          await $api.dataCollections.createSample({
            LaboratoryId: props.labId,
            S3Bucket: bucket,
            Name: s.sampleId,
            Layout: s.layout as SampleLayout,
            Keys: s.files.map((f) => f.fileName),
            FilenameRegex: regexPattern.value,
          });
          created += 1;
        } catch (e: unknown) {
          failedSamples.push(s.sampleId);
          console.error(`Failed to create sample for ${s.sampleId}`, e);
        }
      }

      if (created === 0) {
        toast.error('Failed to create samples. Check your connection and try again.');
        return;
      }
      if (failedSamples.length) {
        toast.warning(`Created ${created} sample(s); ${failedSamples.length} failed.`);
      } else {
        toast.success(`Created ${created} samples`);
      }
      emit('created');
      close();
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <UModal
    :model-value="modelValue"
    :ui="{ width: 'sm:max-w-2xl' }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex max-h-[85vh] flex-col p-6">
      <h2 class="mb-1 text-lg font-medium">Group files into samples</h2>
      <p class="mb-4 text-sm text-gray-500">
        Apply a filename regex to split {{ fileKeys.length }} selected file(s) into samples.
      </p>

      <div class="mb-4 flex gap-2 text-xs">
        <span
          class="rounded-full px-2 py-1"
          :class="step === 1 ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-500'"
        >
          1 · Pattern
        </span>
        <span
          class="rounded-full px-2 py-1"
          :class="step === 2 ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-500'"
        >
          2 · Review
        </span>
        <span
          class="rounded-full px-2 py-1"
          :class="step === 3 ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-500'"
        >
          3 · Confirm
        </span>
      </div>

      <!-- Step 1: Pattern -->
      <div v-if="step === 1" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mb-4 flex flex-wrap gap-2">
          <UButton
            v-for="(preset, key) in REGEX_GROUPING_PRESETS"
            :key="key"
            size="xs"
            :variant="presetKey === key ? 'solid' : 'outline'"
            @click="presetKey = key as RegexGroupingPresetKey"
          >
            {{ preset.label }}
          </UButton>
        </div>
        <UFormGroup label="Regex" class="mb-4">
          <UInput v-model="regexPattern" class="font-mono text-xs" />
        </UFormGroup>
        <p class="mb-2 text-sm text-gray-600">
          From
          <strong>{{ fileKeys.length }}</strong>
          files →
          <strong>{{ proposedSets.length }}</strong>
          samples
        </p>
        <EGRegexUnmatchedNotice
          :unmatched-files="unmatchedFiles"
          :proposed-set-count="proposedSets.length"
          notice-class="mb-2"
        />
        <div
          v-if="proposedSets.length"
          class="max-h-40 overflow-hidden overflow-y-auto rounded-lg border border-gray-200"
        >
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-gray-50">
              <tr>
                <th class="p-2 text-left">Sample ID</th>
                <th class="p-2 text-left">Files</th>
                <th class="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in proposedSets.slice(0, 8)" :key="s.sampleId" class="border-t">
                <td class="p-2 font-medium">{{ s.sampleId }}</td>
                <td class="p-2 font-mono text-gray-500">
                  {{ s.files.map((f) => basenameFromS3Key(f.fileName)).join(', ') }}
                </td>
                <td class="p-2">{{ s.status }}</td>
              </tr>
              <tr v-if="proposedSets.length > 8">
                <td colspan="3" class="p-2 text-center italic text-gray-400">…{{ proposedSets.length - 8 }} more</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Step 2: Review -->
      <div v-else-if="step === 2" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mb-3 flex gap-2 text-xs">
          <span class="rounded-full bg-green-100 px-2 py-1 text-green-800">{{ stats.paired }} paired</span>
          <span class="rounded-full bg-blue-100 px-2 py-1 text-blue-800">{{ stats.single }} single-end</span>
          <span v-if="stats.review" class="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
            {{ stats.review }} needs review
          </span>
        </div>
        <table class="w-full overflow-hidden rounded-lg border border-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="p-2 text-left text-xs">Sample ID</th>
              <th class="p-2 text-left text-xs">Files</th>
              <th class="p-2 text-left text-xs">Status</th>
              <th class="p-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in proposedSets"
              :key="s.sampleId"
              class="border-t"
              :class="{ 'opacity-40': excludedSamples.has(s.sampleId) }"
            >
              <td class="p-2 font-medium">{{ s.sampleId }}</td>
              <td class="p-2 font-mono text-xs text-gray-600">
                {{ s.files.map((f) => basenameFromS3Key(f.fileName)).join(', ') }}
              </td>
              <td class="p-2 text-xs">{{ s.status }}</td>
              <td class="p-2 text-right">
                <button type="button" class="text-xs text-red-600" @click="toggleExclude(s.sampleId)">
                  {{ excludedSamples.has(s.sampleId) ? 'Include' : 'Exclude' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Step 3: Confirm -->
      <div v-else class="flex-1">
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between">
            <dt class="text-gray-500">Files</dt>
            <dd>{{ fileKeys.length }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">Samples</dt>
            <dd>{{ stats.total }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="shrink-0 text-gray-500">Pattern</dt>
            <dd class="break-all text-right font-mono text-xs">{{ regexPattern }}</dd>
          </div>
        </dl>
      </div>

      <div class="mt-4 flex justify-between gap-2 border-t border-gray-200 pt-4">
        <UButton variant="ghost" @click="step > 1 ? step-- : close()">
          {{ step > 1 ? 'Back' : 'Cancel' }}
        </UButton>
        <UButton v-if="step === 1" :disabled="!proposedSets.length" @click="step = 2">Continue to review</UButton>
        <UButton v-else-if="step === 2" :disabled="!activeSets.length" @click="step = 3">Continue to confirm</UButton>
        <UButton v-else :loading="submitting" :disabled="!activeSets.length" @click="confirmCreate">
          Create {{ stats.total }} samples
        </UButton>
      </div>
    </div>
  </UModal>
</template>
