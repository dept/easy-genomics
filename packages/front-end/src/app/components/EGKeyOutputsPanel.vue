<script setup lang="ts">
  import { FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job';
  import {
    canZipAllKeyOutputs,
    isKeyOutputRoleTruncated,
    uniqueKeyOutputObjectKeys,
  } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-download';
  import type {
    RunWorkflowKeyOutput,
    RunWorkflowKeyOutputMatch,
    RunWorkflowKeyOutputsResponse,
    WorkflowKeyOutputDelivery,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import {
    basenameRelative,
    dirnameRelative,
  } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { formatFileSize } from '@FE/utils/file-size';
  import { useToastStore, useUiStore } from '@FE/stores';

  const props = defineProps<{
    labId: string;
    matches: RunWorkflowKeyOutputsResponse;
    workflowName?: string | null;
    canEdit?: boolean;
    delivery?: WorkflowKeyOutputDelivery | null;
  }>();

  const emit = defineEmits<{
    edit: [];
  }>();

  const { handleS3Download, downloadFolder, openHtmlFromS3, isFolderZipInProgress } = useFileDownload();
  const uiStore = useUiStore();
  const toast = useToastStore();

  /** Multi-file roles start expanded so grouped outputs are visible without an extra click. */
  const expandedRoles = ref<string[]>(
    props.matches.KeyOutputs.filter((role) => role.MatchCount > 1).map((role) => role.KeyOutputId),
  );
  const downloadingKey = ref<string | null>(null);

  const headingId = useId();
  const runRootUri = computed(() => `s3://${props.matches.S3Bucket}/${props.matches.S3Prefix}`);

  const uniqueMatchedKeys = computed(() => uniqueKeyOutputObjectKeys(props.matches.KeyOutputs));

  const downloadAllLabel = computed(() => {
    const count = props.matches.MatchedFileCount;
    const countLabel = count === 1 ? '1 file' : `${count.toLocaleString()} files`;
    const sizeLabel = formatFileSize(props.matches.MatchedSizeBytes);
    return sizeLabel ? `Download all · ${countLabel}, ${sizeLabel}` : `Download all · ${countLabel}`;
  });

  const showDelivery = computed(
    () => !!props.delivery?.Enabled && !!props.delivery.DestinationUri?.trim(),
  );

  function roleMeta(role: RunWorkflowKeyOutput): string {
    const countLabel = role.MatchCount === 1 ? '1 file' : `${role.MatchCount.toLocaleString()} files`;
    const sizeLabel = formatFileSize(role.MatchSizeBytes);
    return sizeLabel ? `${countLabel} · ${sizeLabel}` : countLabel;
  }

  function isExpanded(roleId: string): boolean {
    return expandedRoles.value.includes(roleId);
  }

  function toggleExpanded(roleId: string): void {
    expandedRoles.value = isExpanded(roleId)
      ? expandedRoles.value.filter((id) => id !== roleId)
      : [...expandedRoles.value, roleId];
  }

  function fileName(file: RunWorkflowKeyOutputMatch): string {
    return basenameRelative(file.RelativePath);
  }

  function isRoleTruncated(role: RunWorkflowKeyOutput): boolean {
    return isKeyOutputRoleTruncated(role);
  }

  function isHtmlFile(file: RunWorkflowKeyOutputMatch): boolean {
    return fileName(file).toLowerCase().endsWith('.html');
  }

  function directoryUri(file: RunWorkflowKeyOutputMatch): string {
    const parent = dirnameRelative(file.Key);
    return parent ? `s3://${props.matches.S3Bucket}/${parent}` : `s3://${props.matches.S3Bucket}`;
  }

  function objectUri(file: RunWorkflowKeyOutputMatch): string {
    return `s3://${props.matches.S3Bucket}/${file.Key}`;
  }

  async function downloadFile(file: RunWorkflowKeyOutputMatch): Promise<void> {
    downloadingKey.value = file.Key;
    try {
      await handleS3Download(props.labId, fileName(file), directoryUri(file));
    } finally {
      downloadingKey.value = null;
    }
  }

  async function openHtml(file: RunWorkflowKeyOutputMatch): Promise<void> {
    const requestId = `openKeyOutput-${file.Key}`;
    uiStore.setRequestPending(requestId);
    try {
      await openHtmlFromS3(props.labId, objectUri(file));
    } catch (error) {
      console.error(error);
      toast.error('Failed to open HTML file');
    } finally {
      uiStore.setRequestComplete(requestId);
    }
  }

  async function zipKeys(keys: string[], archiveName: string, progressId: string): Promise<void> {
    if (keys.length === 0) {
      toast.error('No matching files to download on this run.');
      return;
    }
    downloadingKey.value = progressId;
    try {
      await downloadFolder(props.labId, runRootUri.value, undefined, { objectKeys: keys, archiveName });
    } finally {
      downloadingKey.value = null;
    }
  }

  function zipAll(): void {
    if (!canZipAllKeyOutputs(props.matches.KeyOutputs, FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT)) {
      toast.error('Too many matching files to zip all key outputs. Download a single role or individual files.');
      return;
    }
    void zipKeys(uniqueMatchedKeys.value, 'key-outputs', 'all-key-outputs');
  }
</script>

<template>
  <section
    :aria-labelledby="headingId"
    class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
  >
    <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <EGText :id="headingId" tag="h3">Results</EGText>
        <p class="text-muted mt-1 text-sm">
          The output files chosen for {{ workflowName || 'this workflow' }}.
          <button
            v-if="canEdit"
            type="button"
            class="text-primary hover:text-primary-dark font-medium hover:underline"
            @click="emit('edit')"
          >
            Change output files
          </button>
        </p>
      </div>
      <EGButton
        v-if="uniqueMatchedKeys.length > 0"
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.primary"
        icon="i-heroicons-arrow-down-tray"
        :icon-right="false"
        :label="downloadAllLabel"
        :loading="downloadingKey === 'all-key-outputs'"
        :disabled="isFolderZipInProgress && downloadingKey !== 'all-key-outputs'"
        @click="zipAll"
      />
    </header>

    <ul class="divide-stroke-light list-none divide-y border-t border-solid" role="list">
      <li v-for="role in matches.KeyOutputs" :key="role.KeyOutputId" class="py-4">
        <!-- Single matched file: show as one row -->
        <template v-if="role.MatchCount === 1 && role.Matches[0]">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-black">{{ role.Label }}</p>
              <p class="text-muted mt-0.5 break-all font-mono text-xs">{{ role.Matches[0].RelativePath }}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-muted text-xs">{{ formatFileSize(role.Matches[0].Size) || roleMeta(role) }}</span>
              <button
                v-if="isHtmlFile(role.Matches[0])"
                type="button"
                class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg"
                :aria-label="`Open ${role.Label}`"
                :disabled="uiStore.isRequestPending(`openKeyOutput-${role.Matches[0].Key}`)"
                @click="openHtml(role.Matches[0])"
              >
                <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg"
                :aria-label="`Download ${role.Label}`"
                :disabled="downloadingKey === role.Matches[0].Key"
                @click="downloadFile(role.Matches[0])"
              >
                <UIcon
                  :name="
                    downloadingKey === role.Matches[0].Key
                      ? 'i-heroicons-arrow-path'
                      : 'i-heroicons-arrow-down-tray'
                  "
                  class="h-4 w-4"
                  :class="{ 'animate-spin': downloadingKey === role.Matches[0].Key }"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </template>

        <!-- Multi-file role: expandable group -->
        <template v-else>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-black">{{ role.Label }}</p>
              <p class="text-muted mt-0.5 break-all font-mono text-xs">{{ role.Pattern }}</p>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3">
              <p v-if="role.Matches.length === 0" class="text-muted text-sm">No files matched on this run.</p>
              <template v-else>
                <button
                  type="button"
                  class="text-muted hover:text-primary inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium"
                  :aria-expanded="isExpanded(role.KeyOutputId)"
                  @click="toggleExpanded(role.KeyOutputId)"
                >
                  {{ role.MatchCount.toLocaleString() }} {{ role.MatchCount === 1 ? 'file' : 'files' }}
                  <UIcon
                    :name="isExpanded(role.KeyOutputId) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
                <span class="text-muted text-xs">{{ formatFileSize(role.MatchSizeBytes) }}</span>
              </template>
            </div>
          </div>

          <ul v-if="isExpanded(role.KeyOutputId)" class="mt-3 list-none space-y-2 border-l border-gray-100 pl-4" role="list">
            <li
              v-for="file in role.Matches"
              :key="file.Key"
              class="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div class="min-w-0">
                <p class="truncate text-black">{{ fileName(file) }}</p>
                <p class="text-muted truncate font-mono text-xs">{{ file.RelativePath }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-muted text-xs">{{ formatFileSize(file.Size) }}</span>
                <button
                  v-if="isHtmlFile(file)"
                  type="button"
                  class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg"
                  :aria-label="`Open ${fileName(file)}`"
                  :disabled="uiStore.isRequestPending(`openKeyOutput-${file.Key}`)"
                  @click="openHtml(file)"
                >
                  <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg"
                  :aria-label="`Download ${fileName(file)}`"
                  :disabled="downloadingKey === file.Key"
                  @click="downloadFile(file)"
                >
                  <UIcon
                    :name="downloadingKey === file.Key ? 'i-heroicons-arrow-path' : 'i-heroicons-arrow-down-tray'"
                    class="h-4 w-4"
                    :class="{ 'animate-spin': downloadingKey === file.Key }"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </li>
            <li v-if="isRoleTruncated(role)" class="text-muted text-xs">
              Showing the first {{ role.Matches.length.toLocaleString() }} matches. Narrow the pattern to see the rest.
            </li>
          </ul>
        </template>
      </li>
    </ul>

    <div v-if="showDelivery" class="border-stroke-light mt-2 border-t border-solid pt-4">
      <h4 class="text-muted mb-3 text-xs font-medium uppercase tracking-wide">Sent to</h4>
      <div class="flex min-w-0 items-start gap-3">
        <UIcon name="i-heroicons-cloud" class="text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-black">Amazon S3</p>
          <p class="text-muted mt-0.5 break-all text-sm">{{ delivery?.DestinationUri }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
