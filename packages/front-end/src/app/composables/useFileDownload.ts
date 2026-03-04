import { FileDownloadResponse } from '@/packages/shared-lib/src/app/types/nf-tower/file/request-file-download';
import { S3Object } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';
import axios from 'axios';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { Ref } from '.nuxt/imports';

export default function useFileDownload() {
  const { $api } = useNuxtApp();

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
    } catch (error) {
      console.error('Error during file download:', error);
    }
  }

  /**
   * Downloads all files under a given S3 folder as a single zip archive.
   *
   * Progress is reported in two phases:
   *   0–90 %  — individual file downloads (increments per completed file)
   *   90–100% — zip generation (reported by JSZip's onUpdate callback)
   *
   * @param labId       - The laboratory ID (needed for presigned URL requests)
   * @param folderS3Uri - Full S3 URI of the folder, e.g. s3://bucket/prefix/results
   * @param folderName  - Name used for the downloaded zip file
   * @param progressRef - Optional ref to write progress (0–100) into
   */
  async function downloadFolder(labId: string, folderS3Uri: string, folderName: string, progressRef?: Ref<number>) {
    const toastStore = useToastStore();

    const withoutScheme = folderS3Uri.replace(/^s3:\/\//, '');
    const slashIdx = withoutScheme.indexOf('/');
    const s3Bucket = slashIdx !== -1 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
    const s3Prefix = slashIdx !== -1 ? withoutScheme.slice(slashIdx + 1) : '';

    const setProgress = (value: number) => {
      if (progressRef) progressRef.value = value;
    };

    try {
      const listResponse = await $api.file.requestListBucketObjects({
        LaboratoryId: labId,
        S3Bucket: s3Bucket,
        S3Prefix: s3Prefix,
      });

      const objects: S3Object[] = listResponse.Contents ?? [];

      if (objects.length === 0) {
        toastStore.info('This folder is empty — nothing to download.');
        setProgress(100);
        return;
      }

      const zip = new JSZip();
      let completedCount = 0;

      // Phase 1: fetch all files in parallel, reporting 0–90% as files complete
      await Promise.allSettled(
        objects.map(async (obj) => {
          const s3Uri = `s3://${s3Bucket}/${obj.Key}`;
          try {
            const urlResponse = await $api.file.fetchPresignedS3Url(labId, s3Uri);
            if (!urlResponse?.DownloadUrl) return;

            const fileResponse = await axios.get<ArrayBuffer>(urlResponse.DownloadUrl, {
              responseType: 'arraybuffer',
            });

            const relativePath = obj.Key.startsWith(s3Prefix)
              ? obj.Key.slice(s3Prefix.length).replace(/^\//, '')
              : obj.Key;

            zip.file(relativePath, fileResponse.data);
          } catch (err) {
            console.warn(`Skipping file ${obj.Key}:`, err);
          } finally {
            completedCount++;
            setProgress(Math.round((completedCount / objects.length) * 90));
          }
        }),
      );

      // Phase 2: generate the zip, reporting 90–100% via JSZip's onUpdate
      const zipBlob = await zip.generateAsync({ type: 'blob' }, ({ percent }) => {
        setProgress(90 + Math.round(percent * 0.1));
      });

      saveAs(zipBlob, `${folderName}.zip`);
      setProgress(100);
    } catch (error) {
      console.error('Error downloading folder as zip:', error);
      toastStore.error('Failed to download folder. Please try again.');
      setProgress(100);
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
  };
}
