<script setup lang="ts">
  import axios from 'axios';
  import { v4 as uuidv4 } from 'uuid';
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type { SequenceSetLayout } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import type {
    FileUploadManifest,
    FileUploadRequest,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
  import {
    groupFilenamesByRegex,
    REGEX_GROUPING_PRESETS,
    type ProposedSequenceSet,
  } from '@easy-genomics/shared-lib/src/app/utils/sequence-set-regex-grouping';
  import { useToastStore, useUiStore } from '@FE/stores';

  type ImportSourceKind = 's3' | 'upload';

  type PendingUploadFile = {
    file: File;
    name: string;
    size: number;
    progress?: number;
    error?: string;
    s3Key?: string;
  };

  const props = defineProps<{
    labId: string;
    lab: Laboratory | null;
    tags: LaboratoryDataTag[];
  }>();

  const emit = defineEmits<{ back: []; completed: [] }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const step = ref(1);
  const importSource = ref<ImportSourceKind>('s3');
  const sourcePath = ref('');
  const presetKey = ref<keyof typeof REGEX_GROUPING_PRESETS>('underscore_r1_r2');
  const regexPattern = ref(REGEX_GROUPING_PRESETS.underscore_r1_r2);
  const sourceFiles = ref<string[]>([]);
  const proposedSets = ref<ProposedSequenceSet[]>([]);
  const excludedSamples = ref<Set<string>>(new Set());
  const setTagIds = ref<Record<string, string[]>>({});
  const submitting = ref(false);

  const uploadTransactionId = ref(uuidv4());
  const pendingUploadFiles = ref<PendingUploadFile[]>([]);
  const uploadedKeysByName = ref<Record<string, string>>({});
  const isDropzoneActive = ref(false);
  const uploading = ref(false);
  const fileInputRef = ref<HTMLInputElement | null>(null);

  const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

  watch(importSource, (kind) => {
    sourceFiles.value = [];
    proposedSets.value = [];
    excludedSamples.value = new Set();
    uploadedKeysByName.value = {};
    pendingUploadFiles.value = [];
    step.value = 1;
    if (kind === 'upload') uploadTransactionId.value = uuidv4();
  });

  watch(presetKey, (k) => {
    regexPattern.value = REGEX_GROUPING_PRESETS[k];
    refreshPreview();
  });

  watch(regexPattern, () => refreshPreview());

  const activeSets = computed(() => proposedSets.value.filter((s) => !excludedSamples.value.has(s.sampleId)));

  const stats = computed(() => {
    const paired = activeSets.value.filter((s) => s.status === 'paired').length;
    const single = activeSets.value.filter((s) => s.status === 'single_end').length;
    const review = activeSets.value.filter((s) => s.status === 'needs_review').length;
    return { paired, single, review, total: activeSets.value.length };
  });

  const importLabel = computed(() => {
    if (importSource.value === 'upload') {
      return `upload-${new Date().toISOString().slice(0, 10)}`;
    }
    return sourcePath.value.split('/').filter(Boolean).pop() || 'import';
  });

  const confirmSourceLabel = computed(() => {
    if (importSource.value === 'upload') {
      return `Upload from computer (${pendingUploadFiles.value.length} files)`;
    }
    return sourcePath.value;
  });

  const canContinueStep1 = computed(() => {
    if (importSource.value === 's3') return sourcePath.value.trim().length > 0;
    return pendingUploadFiles.value.length > 0 && !uploading.value;
  });

  const uploadProgressSummary = computed(() => {
    const total = pendingUploadFiles.value.length;
    if (!total) return '';
    const done = pendingUploadFiles.value.filter((f) => f.progress === 100).length;
    const failed = pendingUploadFiles.value.filter((f) => f.error).length;
    if (uploading.value) return `Uploading ${done}/${total}…`;
    if (failed) return `${failed} failed · ${done}/${total} uploaded`;
    if (done === total) return `${total} files uploaded`;
    return `${total} files selected`;
  });

  function refreshPreview(): void {
    const { sets } = groupFilenamesByRegex(sourceFiles.value, regexPattern.value);
    proposedSets.value = sets;
  }

  function addFilesFromList(fileList: FileList | File[]): void {
    const incoming = Array.from(fileList);
    const existing = new Set(pendingUploadFiles.value.map((f) => f.name));
    for (const file of incoming) {
      if (existing.has(file.name)) continue;
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds the 5 GB upload limit`);
        continue;
      }
      if (file.size < 1) continue;
      pendingUploadFiles.value.push({ file, name: file.name, size: file.size });
      existing.add(file.name);
    }
  }

  function onFileInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFilesFromList(input.files);
    input.value = '';
  }

  function onDrop(e: DragEvent): void {
    isDropzoneActive.value = false;
    if (e.dataTransfer?.files?.length) addFilesFromList(e.dataTransfer.files);
  }

  function removePendingFile(name: string): void {
    pendingUploadFiles.value = pendingUploadFiles.value.filter((f) => f.name !== name);
  }

  async function uploadPendingFiles(): Promise<boolean> {
    if (!props.lab?.S3Bucket || !pendingUploadFiles.value.length) return false;

    uploading.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    uploadedKeysByName.value = {};

    try {
      const request: FileUploadRequest = {
        LaboratoryId: props.labId,
        TransactionId: uploadTransactionId.value,
        Platform: 'AWS HealthOmics',
        Files: pendingUploadFiles.value.map((f) => ({ Name: f.name, Size: f.size })),
      };

      const manifest: FileUploadManifest = await $api.uploads.getFileUploadManifest(request);
      const urlByName = new Map(manifest.Files.map((f) => [f.Name, { url: f.S3Url, key: f.Key }]));

      const results = await Promise.allSettled(
        pendingUploadFiles.value.map(async (entry) => {
          const info = urlByName.get(entry.name);
          if (!info) throw new Error('No upload URL in manifest');
          entry.progress = 0;
          entry.error = undefined;
          await axios.put(info.url, entry.file, {
            onUploadProgress: (ev) => {
              if (ev.total) entry.progress = Math.round((ev.loaded * 100) / ev.total);
            },
          });
          entry.progress = 100;
          entry.s3Key = info.key;
          uploadedKeysByName.value[entry.name] = info.key;
        }),
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            pendingUploadFiles.value[i].error = r.reason instanceof Error ? r.reason.message : 'Upload failed';
          }
        });
        toast.error(`${failed} file(s) failed to upload`);
        return false;
      }

      sourceFiles.value = pendingUploadFiles.value.map((f) => f.name);
      refreshPreview();
      return true;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
      return false;
    } finally {
      uploading.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function loadSourceFiles(): Promise<void> {
    if (importSource.value === 'upload') {
      const ok = await uploadPendingFiles();
      if (ok) step.value = 2;
      return;
    }

    if (!props.lab?.S3Bucket) return;
    uiStore.setRequestPending('dataCollectionsList');
    try {
      const match = sourcePath.value.match(/^s3:\/\/([^/]+)\/(.*)$/);
      const bucket = match?.[1] || props.lab.S3Bucket;
      const prefix = match?.[2] || sourcePath.value.replace(/^\/*/, '');
      const res = await $api.dataCollections.requestLaboratoryBucketObjects({
        LaboratoryId: props.labId,
        RelativePrefix: bucket === props.lab.S3Bucket ? prefix : undefined,
        MaxTotalKeys: 5000,
      });
      sourceFiles.value = (res.Contents || []).map((o) => o.Key!);
      refreshPreview();
      step.value = 2;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to list source files');
    } finally {
      uiStore.setRequestComplete('dataCollectionsList');
    }
  }

  function toggleExclude(sampleId: string): void {
    const next = new Set(excludedSamples.value);
    if (next.has(sampleId)) next.delete(sampleId);
    else next.add(sampleId);
    excludedSamples.value = next;
  }

  function resolveDestKeyForFile(fileName: string, destPrefix: string): string {
    const base = fileName.split('/').pop() || fileName;
    if (importSource.value === 'upload') {
      const key = uploadedKeysByName.value[base];
      if (!key) throw new Error(`Missing uploaded key for ${base}`);
      return key;
    }
    return `${destPrefix}${base}`;
  }

  async function confirmImport(): Promise<void> {
    if (!props.lab?.S3Bucket) return;
    submitting.value = true;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      const labRoot = `${props.lab.OrganizationId}/${props.lab.LaboratoryId}/`;
      const destPrefix = `${labRoot}imports/${importLabel.value}/`;

      const sequenceSets = activeSets.value.map((s) => ({
        Name: s.sampleId,
        Layout: s.layout as SequenceSetLayout,
        Keys: s.files.map((f) => resolveDestKeyForFile(f.fileName, destPrefix)),
        TagIds: setTagIds.value[s.sampleId],
        FilenameRegex: regexPattern.value,
      }));

      const copyJobs =
        importSource.value === 's3'
          ? activeSets.value.flatMap((s) =>
              s.files.map((f) => {
                const base = f.fileName.split('/').pop() || f.fileName;
                const match = sourcePath.value.match(/^s3:\/\/([^/]+)\/(.*)$/);
                const srcBucket = match?.[1] || props.lab!.S3Bucket!;
                const srcPrefix = match?.[2] || '';
                const srcKey = srcPrefix ? `${srcPrefix.replace(/\/?$/, '/')}${base}` : f.fileName;
                return {
                  SourceBucket: srcBucket,
                  SourceKey: srcKey,
                  DestKey: `${destPrefix}${base}`,
                };
              }),
            )
          : undefined;

      const res = await $api.dataCollections.bulkCreateSequenceSets({
        LaboratoryId: props.labId,
        S3Bucket: props.lab.S3Bucket,
        ImportLabel: importLabel.value,
        SequenceSets: sequenceSets,
        CopyJobs: copyJobs,
      });

      toast.success(`Created ${res.CreatedCount} sequence sets`);
      emit('completed');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      submitting.value = false;
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <button type="button" class="hover:text-primary mb-3 w-fit text-sm text-gray-500" @click="emit('back')">
      ← Back to Data Collections
    </button>
    <h1 class="mb-1 text-2xl font-medium">Import data</h1>
    <p class="mb-4 text-sm text-gray-500">Bring files in and build sequence sets in one flow.</p>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white">
      <div class="flex border-b border-gray-200 bg-gray-50 text-sm">
        <div
          v-for="n in 4"
          :key="n"
          class="flex-1 border-r border-gray-100 px-4 py-3"
          :class="{ 'bg-white font-medium': step === n }"
        >
          Step {{ n }}
        </div>
      </div>

      <!-- Step 1: Source -->
      <div v-if="step === 1" class="flex-1 overflow-y-auto p-6">
        <h3 class="mb-2 font-medium">Where are the files?</h3>
        <p class="mb-4 text-sm text-gray-500">
          Pick a source. Files are copied or uploaded into the lab bucket on import — external originals are never
          modified.
        </p>

        <div class="mb-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            class="rounded-lg border-2 p-4 text-left transition-colors"
            :class="importSource === 's3' ? 'border-primary bg-primary-50' : 'border-gray-200 hover:border-gray-300'"
            @click="importSource = 's3'"
          >
            <div class="mb-1 text-sm font-medium">Amazon S3</div>
            <div class="mb-2 text-xs text-gray-500">Connected</div>
            <p class="text-xs text-gray-500">Point at a bucket/prefix where sequencer or partner files are dropped.</p>
          </button>

          <button
            type="button"
            class="rounded-lg border-2 p-4 text-left transition-colors"
            :class="
              importSource === 'upload' ? 'border-primary bg-primary-50' : 'border-gray-200 hover:border-gray-300'
            "
            @click="importSource = 'upload'"
          >
            <div class="mb-1 text-sm font-medium">Upload from computer</div>
            <div class="mb-2 text-xs text-gray-500">Drag &amp; drop</div>
            <p class="text-xs text-gray-500">For local files. Browser upload directly into the lab bucket.</p>
          </button>
        </div>

        <div v-if="importSource === 's3'">
          <UFormGroup label="S3 path" hint="bucket + prefix">
            <UInput v-model="sourcePath" placeholder="s3://bucket/prefix/" class="font-mono" />
          </UFormGroup>
        </div>

        <div v-else>
          <input
            ref="fileInputRef"
            type="file"
            multiple
            accept=".fastq,.fq,.gz,.fasta,.fa,.fa.gz"
            class="hidden"
            @change="onFileInputChange"
          />
          <div
            class="rounded-lg border-2 border-dashed p-8 text-center transition-colors"
            :class="isDropzoneActive ? 'border-primary bg-primary-50' : 'border-gray-200'"
            @dragenter.prevent="isDropzoneActive = true"
            @dragleave.prevent="isDropzoneActive = false"
            @dragover.prevent
            @drop.prevent="onDrop"
          >
            <p class="mb-3 text-sm text-gray-600">
              <span v-if="isDropzoneActive" class="text-primary font-medium">Drop files here</span>
              <span v-else>Drag and drop your files here, or</span>
            </p>
            <UButton variant="outline" size="sm" :disabled="uploading" @click="fileInputRef?.click()">
              Choose files
            </UButton>
            <p v-if="uploadProgressSummary" class="mt-3 text-xs text-gray-500">{{ uploadProgressSummary }}</p>
          </div>

          <ul
            v-if="pendingUploadFiles.length"
            class="mt-4 max-h-48 divide-y overflow-y-auto rounded-lg border border-gray-200"
          >
            <li v-for="f in pendingUploadFiles" :key="f.name" class="flex items-center gap-3 px-3 py-2 text-sm">
              <span class="flex-1 truncate font-mono text-xs">{{ f.name }}</span>
              <span class="shrink-0 text-xs text-gray-400">{{ (f.size / (1024 * 1024)).toFixed(1) }} MB</span>
              <span v-if="f.progress != null && f.progress < 100" class="text-primary shrink-0 text-xs">
                {{ f.progress }}%
              </span>
              <span v-else-if="f.progress === 100" class="shrink-0 text-xs text-green-600">done</span>
              <span v-if="f.error" class="shrink-0 text-xs text-red-600">{{ f.error }}</span>
              <button
                v-if="!uploading"
                type="button"
                class="shrink-0 text-xs text-gray-400 hover:text-red-600"
                @click="removePendingFile(f.name)"
              >
                Remove
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Step 2: Pattern -->
      <div v-else-if="step === 2" class="flex-1 overflow-y-auto p-6">
        <h3 class="mb-2 font-medium">How are files grouped?</h3>
        <div class="mb-4 flex flex-wrap gap-2">
          <UButton
            v-for="(pattern, key) in REGEX_GROUPING_PRESETS"
            :key="key"
            size="xs"
            :variant="presetKey === key ? 'solid' : 'outline'"
            @click="presetKey = key as keyof typeof REGEX_GROUPING_PRESETS"
          >
            {{ key.replace(/_/g, ' ') }}
          </UButton>
        </div>
        <UFormGroup label="Regex">
          <UInput v-model="regexPattern" class="font-mono text-xs" />
        </UFormGroup>
        <p class="mt-4 text-sm text-gray-500">
          From {{ sourceFiles.length }} files →
          <strong>{{ proposedSets.length }} sequence sets</strong>
        </p>
      </div>

      <!-- Step 3: Build -->
      <div v-else-if="step === 3" class="flex min-h-0 flex-1 flex-col">
        <div class="flex gap-2 border-b p-4 text-xs">
          <span class="rounded-full bg-green-100 px-2 py-1 text-green-800">{{ stats.paired }} paired</span>
          <span class="rounded-full bg-blue-100 px-2 py-1 text-blue-800">{{ stats.single }} single-end</span>
          <span v-if="stats.review" class="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
            {{ stats.review }} needs review
          </span>
        </div>
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-gray-50">
              <tr>
                <th class="p-3 text-left">Sample ID</th>
                <th class="p-3 text-left">Files</th>
                <th class="p-3 text-left">Status</th>
                <th class="p-3" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in proposedSets"
                :key="s.sampleId"
                class="border-t"
                :class="{ 'opacity-40': excludedSamples.has(s.sampleId) }"
              >
                <td class="p-3 font-medium">{{ s.sampleId }}</td>
                <td class="p-3 font-mono text-xs">{{ s.files.map((f) => f.fileName.split('/').pop()).join(', ') }}</td>
                <td class="p-3 text-xs">{{ s.status }}</td>
                <td class="p-3 text-right">
                  <button type="button" class="text-xs text-red-600" @click="toggleExclude(s.sampleId)">
                    {{ excludedSamples.has(s.sampleId) ? 'Include' : 'Exclude' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Step 4: Confirm -->
      <div v-else class="flex-1 p-6">
        <h3 class="mb-4 font-medium">Confirm &amp; create</h3>
        <dl class="max-w-md space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="shrink-0 text-gray-500">Source</dt>
            <dd class="break-all text-right font-mono text-xs">{{ confirmSourceLabel }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">Sequence sets</dt>
            <dd>{{ stats.total }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">Destination</dt>
            <dd class="font-mono">s3://{{ lab?.S3Bucket }}/</dd>
          </div>
        </dl>
      </div>

      <div class="flex justify-between border-t bg-white p-4">
        <UButton v-if="step > 1" variant="ghost" @click="step--">Back</UButton>
        <div v-else />
        <UButton v-if="step === 1" :disabled="!canContinueStep1" :loading="uploading" @click="loadSourceFiles">
          {{ importSource === 'upload' ? 'Upload & continue to pattern' : 'Continue to pattern' }}
        </UButton>
        <UButton v-else-if="step === 2" @click="step = 3">Continue to build</UButton>
        <UButton v-else-if="step === 3" @click="step = 4">Continue to confirm</UButton>
        <UButton v-else :loading="submitting" @click="confirmImport">
          {{
            importSource === 's3' ? `Copy & create ${stats.total} sequence sets` : `Create ${stats.total} sequence sets`
          }}
        </UButton>
      </div>
    </div>
  </div>
</template>
