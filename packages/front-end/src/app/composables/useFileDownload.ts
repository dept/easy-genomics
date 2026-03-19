import { FileDownloadResponse } from '@/packages/shared-lib/src/app/types/nf-tower/file/request-file-download';
import { FolderDownloadJobStatusResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-folder-download-job-status';
import axios from 'axios';
import { saveAs } from 'file-saver';
import { Ref } from '.nuxt/imports';

export default function useFileDownload() {
  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const isFolderZipInProgress = ref(false);

  const sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });

  const folderTooLargeMessage =
    'This folder exceeds the accepted 3GB size. Please contact support to get the folder content downloaded.';

  const triggerDownloadInSameTab = (downloadUrl: string): void => {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Downloads a file from S3 using a presigned URL and saves it locally
  async function handleS3Download(
    labId: string,
    fileName: string,
    path: string,
    progressVar?: Ref<number> | undefined,
  ) {
    const fileDownloadPath = `${path}/${fileName}`;

    try {
      // Fetch the presigned URL from the API
      const fileDownloadResponse: FileDownloadResponse = await $api.file.fetchPresignedS3Url(labId, fileDownloadPath);

      if (!fileDownloadResponse || !fileDownloadResponse.DownloadUrl) {
        console.error('Download URL is undefined or empty');
        return;
      }

      const downloadUrl = fileDownloadResponse.DownloadUrl;

      // Download the file to memory
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'arraybuffer',
        // handle progress events
        onDownloadProgress: (progressEvent) => {
          // set the value of the progress ref if it's been provided
          if (progressVar !== undefined) {
            progressVar.value = Math.round((progressEvent?.loaded / progressEvent?.total) * 100);
          }
        },
      });

      // Convert ArrayBuffer response data to blob
      const blob = new Blob([response.data]);

      // Use FileSaver to save the blob to a file
      saveAs(blob, fileName);

      // Ensure the UI reaches 100% at completion (axios sometimes ends at <100).
      if (progressVar !== undefined) progressVar.value = 100;
    } catch (error) {
      console.error('Error during file download:', error);

      // Still set completion so the UI can clean up the progress overlay.
      if (progressVar !== undefined) progressVar.value = 100;
    }
  }

  // Creates an async folder zip job and polls until the archive is ready.
  async function downloadFolder(labId: string, folderS3Path: string, progressVar?: Ref<number> | undefined) {
    const maxAttempts = 120; // ~10 minutes with 5s polling
    const pollIntervalMs = 5000;

    try {
      if (isFolderZipInProgress.value) {
        toast.error('A folder ZIP download is already in progress. Please wait for it to finish.');
        return;
      }
      isFolderZipInProgress.value = true;
      progressVar && (progressVar.value = 10);

      const createJobResponse = await $api.file.requestFolderDownloadJob({
        LaboratoryId: labId,
        S3Prefix: folderS3Path,
      });

      if (!createJobResponse?.JobId) {
        throw new Error('Missing folder download job id');
      }

      let statusResponse: FolderDownloadJobStatusResponse | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        statusResponse = await $api.file.requestFolderDownloadJobStatus({
          LaboratoryId: labId,
          JobId: createJobResponse.JobId,
        });

        if (statusResponse.Status === 'COMPLETED' && statusResponse.DownloadUrl) {
          progressVar && (progressVar.value = 100);
          triggerDownloadInSameTab(statusResponse.DownloadUrl);
          return;
        }

        if (statusResponse.Status === 'FAILED') {
          throw new Error(statusResponse.ErrorMessage || 'Folder archive generation failed');
        }

        progressVar && (progressVar.value = Math.min(95, 10 + Math.floor(((attempt + 1) / maxAttempts) * 85)));
        await sleep(pollIntervalMs);
      }

      throw new Error(statusResponse?.ErrorMessage || 'Folder archive took too long to prepare');
    } catch (error: any) {
      progressVar && (progressVar.value = 100);
      console.error('Error during folder download:', error);
      const errorMessage = error?.message || '';
      if (errorMessage.includes('folder is too large to download')) {
        toast.error(folderTooLargeMessage);
      } else {
        toast.error(errorMessage || 'Unable to prepare folder download');
      }
    } finally {
      isFolderZipInProgress.value = false;
    }
  }

  // Checks if the file extension is supported for download
  function isSupportedFileType(filename: string): boolean {
    const supportedExtensions = ['.csv', '.txt'];
    const extensionIndex = filename.lastIndexOf('.');

    if (extensionIndex === -1) {
      return false; // No extension found
    }

    const extension = filename.slice(extensionIndex).toLowerCase();
    return supportedExtensions.includes(extension);
  }

  return {
    handleS3Download,
    downloadFolder,
    isSupportedFileType,
    isFolderZipInProgress,
  };
}
