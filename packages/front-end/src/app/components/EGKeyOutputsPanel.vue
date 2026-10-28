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
    canEdit?: boolean;
  }>();

  const emit = defineEmits<{
    edit: [];
  }>();

  const { handleS3Download, downloadFolder, openHtmlFromS3, isFolderZipInProgress } = useFileDownload();
  const uiStore = useUiStore();
  const toast = useToastStore();

  const expandedRoles = ref<string[]>([]);
  const downloadingKey = ref<string | null>(null);

  const headingId = useId();
  const runRootUri = computed(() => `s3://${props.matches.S3Bucket}/${props.matches.S3Prefix}`);

  const uniqueMatchedKeys = computed(() => uniqueKeyOutputObjectKeys(props.matches.KeyOutputs));

  const filesSummary = computed(() => {
    const matched = props.matches.MatchedFileCount.toLocaleString();
    const total = props.matches.TotalFileCount.toLocaleString();
    return `${matched} of ${total} files`;
  });

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

  function zipRole(role: RunWorkflowKeyOutput): void {
    if (isRoleTruncated(role)) {
      toast.error('Too many matching files to zip this role. Download individual files or narrow the pattern.');
      return;
    }
    void zipKeys(
      role.Matches.map((file) => file.Key),
      role.Label,
      `role-${role.KeyOutputId}`,
    );
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
  <section :aria-labelledby="headingId" class="bg-primary-muted rounded-2xl p-5">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <EGText :id="headingId" tag="h3">Key outputs</EGText>
          <p class="text-primary text-sm font-medium">{{ filesSummary }}</p>
        </div>
        <p class="text-muted mt-1 text-sm">
          Defined for this workflow by your lab.
          <button
            v-if="canEdit"
            type="button"
            class="text-primary hover:text-primary-dark font-medium hover:underline"
            @click="emit('edit')"
          >
            Edit
          </button>
        </p>
      </div>
      <EGButton
        v-if="uniqueMatchedKeys.length > 0"
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        icon="i-heroicons-arrow-down-tray"
        :icon-right="false"
        label="Download all key outputs"
        :loading="downloadingKey === 'all-key-outputs'"
        :disabled="isFolderZipInProgress && downloadingKey !== 'all-key-outputs'"
        @click="zipAll"
      />
    </header>

    <ul class="list-none space-y-5" role="list">
      <li v-for="role in matches.KeyOutputs" :key="role.KeyOutputId">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p class="text-heading font-serif text-base font-medium">{{ role.Label }}</p>
              <p class="text-muted text-sm">{{ roleMeta(role) }}</p>
            </div>
            <p class="text-muted mt-0.5 break-all font-mono text-xs">{{ role.Pattern }}</p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <template v-if="role.MatchCount === 1 && role.Matches[0]">
              <EGButton
                v-if="isHtmlFile(role.Matches[0])"
                :size="ButtonSizeEnum.enum.sm"
                :variant="ButtonVariantEnum.enum.secondary"
                icon="i-heroicons-arrow-top-right-on-square"
                label="Open"
                :loading="uiStore.isRequestPending(`openKeyOutput-${role.Matches[0].Key}`)"
                @click="openHtml(role.Matches[0])"
              />
              <EGButton
                :size="ButtonSizeEnum.enum.sm"
                :variant="ButtonVariantEnum.enum.secondary"
                icon="i-heroicons-arrow-down-tray"
                :icon-right="false"
                label="Download"
                :loading="downloadingKey === role.Matches[0].Key"
                @click="downloadFile(role.Matches[0])"
              />
            </template>
            <template v-else>
              <button
                v-if="role.Matches.length > 0"
                type="button"
                class="text-primary hover:text-primary-dark inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium"
                :aria-expanded="isExpanded(role.KeyOutputId)"
                @click="toggleExpanded(role.KeyOutputId)"
              >
                {{ isExpanded(role.KeyOutputId) ? 'Hide' : `View all ${role.MatchCount.toLocaleString()}` }}
                <UIcon
                  :name="isExpanded(role.KeyOutputId) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
              </button>
              <EGButton
                v-if="role.Matches.length > 0"
                :size="ButtonSizeEnum.enum.sm"
                :variant="ButtonVariantEnum.enum.secondary"
                icon="i-heroicons-arrow-down-tray"
                :icon-right="false"
                label="Download as zip"
                :loading="downloadingKey === `role-${role.KeyOutputId}`"
                :disabled="isFolderZipInProgress && downloadingKey !== `role-${role.KeyOutputId}`"
                @click="zipRole(role)"
              />
              <p v-else class="text-muted text-sm">No files matched on this run.</p>
            </template>
          </div>
        </div>

        <ul v-if="isExpanded(role.KeyOutputId)" class="mt-3 list-none space-y-2 pt-1" role="list">
          <li
            v-for="file in role.Matches"
            :key="file.Key"
            class="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <div class="min-w-0">
              <p class="text-heading truncate">{{ fileName(file) }}</p>
              <p class="text-muted truncate font-mono text-xs">{{ file.RelativePath }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-muted text-xs">{{ formatFileSize(file.Size) }}</span>
              <EGButton
                v-if="isHtmlFile(file)"
                :size="ButtonSizeEnum.enum.sm"
                :variant="ButtonVariantEnum.enum.secondary"
                icon="i-heroicons-arrow-top-right-on-square"
                label="Open"
                :loading="uiStore.isRequestPending(`openKeyOutput-${file.Key}`)"
                @click="openHtml(file)"
              />
              <EGButton
                :size="ButtonSizeEnum.enum.sm"
                :variant="ButtonVariantEnum.enum.secondary"
                icon="i-heroicons-arrow-down-tray"
                :icon-right="false"
                label="Download"
                :loading="downloadingKey === file.Key"
                @click="downloadFile(file)"
              />
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
