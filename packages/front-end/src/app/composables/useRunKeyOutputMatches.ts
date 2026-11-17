import { FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job';
import type {
  RunWorkflowKeyOutput,
  RunWorkflowKeyOutputMatch,
  RunWorkflowKeyOutputsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import {
  canZipAllKeyOutputs,
  isKeyOutputRoleTruncated,
  uniqueKeyOutputObjectKeys,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-download';
import {
  basenameRelative,
  dirnameRelative,
  isWholeFolderPattern,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
import { useToastStore, useUiStore } from '@FE/stores';

/** Shared download / expand helpers for Selected results and legacy key-outputs panels. */
export default function useRunKeyOutputMatches(
  labId: MaybeRefOrGetter<string>,
  matches: MaybeRefOrGetter<RunWorkflowKeyOutputsResponse>,
) {
  const { handleS3Download, downloadFolder, openHtmlFromS3, isFolderZipInProgress } = useFileDownload();
  const uiStore = useUiStore();
  const toast = useToastStore();

  const expandedRoles = ref<string[]>(
    toValue(matches)
      .KeyOutputs.filter((role) => role.MatchCount > 1)
      .map((role) => role.KeyOutputId),
  );
  const downloadingKey = ref<string | null>(null);

  const runRootUri = computed(() => {
    const current = toValue(matches);
    return `s3://${current.S3Bucket}/${current.S3Prefix}`;
  });
  const uniqueMatchedKeys = computed(() => uniqueKeyOutputObjectKeys(toValue(matches).KeyOutputs));

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

  function isFolderPattern(pattern: string): boolean {
    return isWholeFolderPattern(pattern);
  }

  function directoryUri(file: RunWorkflowKeyOutputMatch): string {
    const parent = dirnameRelative(file.Key);
    const bucket = toValue(matches).S3Bucket;
    return parent ? `s3://${bucket}/${parent}` : `s3://${bucket}`;
  }

  function objectUri(file: RunWorkflowKeyOutputMatch): string {
    return `s3://${toValue(matches).S3Bucket}/${file.Key}`;
  }

  async function downloadFile(file: RunWorkflowKeyOutputMatch): Promise<void> {
    downloadingKey.value = file.Key;
    try {
      await handleS3Download(toValue(labId), fileName(file), directoryUri(file));
    } finally {
      downloadingKey.value = null;
    }
  }

  async function openHtml(file: RunWorkflowKeyOutputMatch): Promise<void> {
    const requestId = `openKeyOutput-${file.Key}`;
    uiStore.setRequestPending(requestId);
    try {
      await openHtmlFromS3(toValue(labId), objectUri(file));
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
      await downloadFolder(toValue(labId), runRootUri.value, undefined, { objectKeys: keys, archiveName });
    } finally {
      downloadingKey.value = null;
    }
  }

  function zipRole(role: RunWorkflowKeyOutput, archiveFallback: string): void {
    zipKeys(
      role.Matches.map((file) => file.Key),
      role.Label.replace(/\s+/g, '-').toLowerCase() || archiveFallback,
      role.KeyOutputId,
    ).catch((error) => console.error(error));
  }

  function downloadRole(role: RunWorkflowKeyOutput, archiveFallback: string): void {
    if (role.MatchCount === 1 && role.Matches[0]) {
      downloadFile(role.Matches[0]).catch((error) => console.error(error));
      return;
    }
    zipRole(role, archiveFallback);
  }

  function zipAll(archiveName: string, progressId: string, tooManyMessage: string): void {
    if (!canZipAllKeyOutputs(toValue(matches).KeyOutputs, FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT)) {
      toast.error(tooManyMessage);
      return;
    }
    zipKeys(uniqueMatchedKeys.value, archiveName, progressId).catch((error) => console.error(error));
  }

  return {
    expandedRoles,
    downloadingKey,
    isFolderZipInProgress,
    runRootUri,
    uniqueMatchedKeys,
    isExpanded,
    toggleExpanded,
    fileName,
    isRoleTruncated,
    isHtmlFile,
    isFolderPattern,
    downloadFile,
    openHtml,
    zipRole,
    downloadRole,
    zipAll,
    uiStore,
  };
}
