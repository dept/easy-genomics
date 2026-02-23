<script setup lang="ts">
  import axios from 'axios';
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import {
    FileUploadInfo,
    FileUploadManifest,
    FileUploadRequest,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-manifest';
  import {
    SampleSheetRequest,
    SampleSheetResponse,
    UploadedFileInfo,
    UploadedFilePairInfo,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-sample-sheet';
  import { useToastStore } from '@FE/stores';
  import { useNetwork } from '@vueuse/core';
  import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';

  type UploadStatus = 'idle' | 'uploading' | 'success' | 'failed';

  export type FilePair = {
    sampleId: string; // Common start of the file name for each of the file pair e.g. GOL2051A67473_S133_L002 when uploading the pair of files GOL2051A67473_S133_L002_R1_001.fastq.gz and GOL2051A67473_S133_L002_R2_001.fastq.gz
    r1File?: FileDetails;
    r2File?: FileDetails;
  };

  type FileDetails = {
    file: File;
    name: string;
    size: number;
    // progress not present means upload hasn't started yet - this is important for the uploadStatus computed
    progress?: number;
    location?: string;
    url?: string;
    error?: string;
  };

  interface UploadError {
    fileName: string;
    error: string;
    code?: string;
    userMessage?: string;
  }

  const { $api } = useNuxtApp();
  const { isOnline } = useNetwork();
  const { platformToWipRunUpdateFunction, platformToWipRunUpdateParamsFunction, getWipRunForPlatform } =
    useMultiplatform();

  const toastStore = useToastStore();
  const labsStore = useLabsStore();
  const uiStore = useUiStore();

  const emit = defineEmits(['next-step', 'previous-step', 'step-validated']);
  const props = defineProps<{
    labId: string;
    pipelineOrWorkflowName: string;
    platform: RunType;
    wipRunTempId: string;
  }>();

  const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
  const MIN_FILE_SIZE = 1; // 1byte
  const UPLOAD_TIMEOUT = 600000; // 10 mins

  const chooseFilesButton = ref<HTMLButtonElement | null>(null);
  const isDropzoneActive = ref(false);
  const showAdvancedOptions = ref(false);
  const sampleIdSplitPattern = ref('');

  // Track ongoing upload requests
  const uploadControllers = ref<{ [key: string]: AbortController }>({});

  const labName = computed<string | null>(() => labsStore.labs[props.labId]?.Name || null);

  const wipRun = computed<WipRun>(() => getWipRunForPlatform(props.platform, props.wipRunTempId));

  const wipRunUpdateFunction = computed<Function>(() => platformToWipRunUpdateFunction(props.platform));
  const wipRunUpdateParamsFunction = computed<Function>(() => platformToWipRunUpdateParamsFunction(props.platform));

  // file handling stuff

  function setFiles(files: FilePair[]) {
    wipRunUpdateFunction.value(props.wipRunTempId, { files });
  }

  const filePairs = computed<FilePair[]>(() => {
    // initialize files if not present
    if (wipRun.value.files === undefined) {
      setFiles([]);
    }

    return wipRun.value.files!;
  });

  const files = computed<FileDetails[]>(() => {
    const files = [];
    for (const filePair of filePairs.value) {
      if (filePair.r1File) files.push(filePair.r1File);
      if (filePair.r2File) files.push(filePair.r2File);
    }
    return files;
  });

  const filesNotUploaded = computed<FileDetails[]>(() =>
    files.value.filter((file) => file.error || file.progress !== 100),
  );

  const hasSampleSheetUrl = computed<boolean>(() => !!wipRun.value.sampleSheetS3Url);

  const haveUnmatchedFiles = computed<boolean>(() =>
    filePairs.value.some((filePair) => !filePair.r1File || !filePair.r2File),
  );
  const haveMatchedFiles = computed<boolean>(() =>
    filePairs.value.some((filePair) => filePair.r1File && filePair.r2File),
  );

  const areAllFilesUploaded = computed(() => filesNotUploaded.value.length === 0);

  const areAllPairsComplete = computed<boolean>(() => {
    return filePairs.value.every((pair) => pair.r1File);
  });

  const canProceedToNextStep = computed<boolean>(() => {
    // Check both conditions:
    // 1. All existing files are uploaded successfully
    // 2. All pairs are complete (have both R1 and R2)
    return areAllFilesUploaded.value && areAllPairsComplete.value && hasSampleSheetUrl.value;
  });

  // overall upload status for all files
  const uploadStatus = computed<UploadStatus>(() => {
    // if any file has a progress below 100 and doesn't have an error, upload is in progress
    if (files.value.some((file) => file.progress !== undefined && file.progress < 100 && !file.error))
      return 'uploading';
    // else if any file has an error, upload failed
    if (files.value.some((file) => !!file.error)) return 'failed';
    // else if there are files and they all have progress 100, upload succeeded
    if (files.value.length > 0 && files.value.every((file) => !file.error && file.progress === 100)) return 'success';
    // else must be idle
    return 'idle';
  });

  const showGenerateSampleSheetButton = computed<boolean>(
    () =>
      uploadStatus.value === 'success' && // everything uploaded
      filesProblemAlertMessage.value === null && // no file problems
      !wipRun.value.sampleSheetS3Url, // no sample sheet yet
  );

  const filesForTable = computed(() => {
    const files: { sampleId: string; fileName: string; progress: number; error?: string }[] = [];

    filePairs.value.forEach((filePair: FilePair) => {
      if (filePair.r1File) {
        files.push({
          sampleId: filePair.sampleId,
          fileName: filePair.r1File.name,
          progress: filePair.r1File.progress || 0,
          error: filePair.r1File.error,
        });
      }
      if (filePair.r2File) {
        files.push({
          sampleId: filePair.sampleId,
          fileName: filePair.r2File.name,
          progress: filePair.r2File.progress || 0,
          error: filePair.r2File.error,
        });
      }
    });

    return files;
  });

  const isDropzoneEnabled = computed(() => uploadStatus.value !== 'uploading');

  const filesProblemAlertMessage = computed<string | null>(() => {
    // don't need internet connection message because the modal takes care of it
    // don't need no files uploaded message because there will visibly be nothing there which should be self explanatory
    if (!areAllPairsComplete.value) return 'There is an R2 file with no matching R1 file.';
    if (haveMatchedFiles.value && haveUnmatchedFiles.value)
      return 'There is a mix of single files and pair files. Files must be all single files or all pair files.';
    // don't need uploading message because there's already a visual indicator of activity in progress

    return null;
  });

  const isUploadButtonDisabled = computed(() => {
    const noInternet = !isOnline.value;
    const noFiles = filesNotUploaded.value.length === 0;
    const hasIncompletePairs = !areAllPairsComplete.value;
    const hasBothSinglesAndPairs = haveMatchedFiles.value && haveUnmatchedFiles.value;
    const isUploading = uploadStatus.value === 'uploading';

    return noInternet || noFiles || hasIncompletePairs || hasBothSinglesAndPairs || isUploading;
  });

  // reset files error states
  function clearErrorsFromFiles(files: FileDetails[]) {
    files.forEach((file) => {
      file.error = undefined;
      file.progress = undefined;
    });
  }

  // set progress to 0 - this makes the computed uploadStatus get set to 'uploading'
  function initializeProgressForFiles(files: FileDetails[]) {
    files.forEach((file) => {
      file.progress = 0;
    });
  }

  function removeStoredSampleSheetInfo() {
    wipRunUpdateFunction.value(props.wipRunTempId, {}, ['sampleSheetS3Url']);
  }

  // gives error message to all files - used for when an error occurs above the individual file level
  function applyErrorToFiles(files: FileDetails[], errorMessage: string) {
    files.forEach((file) => {
      file.error = errorMessage;
    });
  }

  function chooseFiles() {
    chooseFilesButton.value?.click();
  }

  function handleDroppedFiles(e: DragEvent) {
    if (!e.isTrusted) {
      console.error('Drop event not trusted');
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    addFiles(files);
  }

  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target) {
      console.error('File input change event target not found');
      return;
    }

    const files = target.files;
    if (!files) return;

    addFiles(files);
  }

  function addFiles(files: FileList) {
    const invalidFiles = Array.from(files).filter((file) => !isValidGzFile(file));
    const validFiles = Array.from(files).filter((file) => isValidGzFile(file));

    invalidFiles.forEach((file) => {
      const message = `File ${file.name} is not a .gz file`;
      useToastStore().error(message);
    });

    validFiles.forEach((file) => addFile(file));
  }

  function isValidGzFile(file: File): boolean {
    return file.name.endsWith('.gz');
  }

  function addFile(file: File) {
    if (file.size < MIN_FILE_SIZE) {
      const message = `File ${file.name} is too small: ${file.size} bytes`;
      useToastStore().error(message);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      const message = `File ${file.name} is too large: ${file.size} bytes. Maximum allowed size is 5GB.`;
      useToastStore().error(message);
      return;
    }

    const isDuplicateFile = checkIsFileDuplicate(file);

    if (isDuplicateFile) {
      const message = `File ${file.name} already exists`;
      useToastStore().error(message);
      return;
    }

    // remove the sample sheet because it's outdated now
    removeStoredSampleSheetInfo();

    const fileDetails = getFileDetails(file);
    addFileToFilePairs(fileDetails);
  }

  function checkIsFileDuplicate(newFile: File): boolean {
    return files.value.some((fileDetails: FileDetails) => fileDetails.name === newFile.name);
  }

  function getFileDetails(file: File): FileDetails {
    return {
      file,
      size: file.size,
      name: file.name,
      progress: undefined, // Reset progress
      error: undefined, // Reset error state
      url: undefined, // Reset upload URL
    };
  }

  function addFileToFilePairs(fileDetails: FileDetails) {
    const sampleId = getSampleIdFromRFileName(fileDetails.name);
    const fileName = getFileNameWithoutExt(fileDetails.name);

    // handle files without R values
    if (!sampleId) {
      // file does not have an R_ value, so it must be a single file, and cannot be paired
      // make a new pair with just this file as R1
      filePairs.value.push({
        sampleId: fileName, // individual files use the fileName as sampleId
        r1File: fileDetails,
      });
      return;
    }

    // handle files with R values:

    // find (if it exists) the file pair whose (potential) shared sample id matches this file
    const existingFilePair = filePairs.value.find(
      (filePair) => getSharedSampleIdFromPair(filePair.r1File?.name, filePair.r2File?.name) === sampleId,
    );
    // use that one if it exists, or otherwise make a new one
    const filePair: FilePair = existingFilePair || { sampleId: fileName };

    try {
      addToFilePair(fileDetails, filePair);
      if (!existingFilePair) {
        filePairs.value.push(filePair);
      }
    } catch (error: any) {
      console.warn('Error adding file to file pair:', error);
    }

    // update sampleId
    if (!filePair.r1File || !filePair.r2File) {
      // individual files should use the fileName, so that _R1_s can be used as single files
      filePair.sampleId = fileName;
    } else {
      // paired files should use the shared sampleId
      filePair.sampleId = sampleId;
    }
  }

  function addToFilePair(fileDetails: FileDetails, filePair: FilePair) {
    if (fileDetails.name.includes('_R1_')) {
      filePair.r1File = fileDetails;
    } else if (fileDetails.name.includes('_R2_')) {
      filePair.r2File = fileDetails;
    } else {
      const message = `File ${fileDetails.name} does not contain _R1_ or _R2_`;
      useToastStore().error(message);
      throw new Error(message);
    }
  }

  function getSampleIdFromRFileName(fileName: string): string | null {
    if (sampleIdSplitPattern.value) {
      const idx = fileName.indexOf(sampleIdSplitPattern.value);
      return idx !== -1 ? fileName.substring(0, idx) || null : null;
    }
    return fileName.substring(0, fileName.lastIndexOf('_R')) || null;
  }

  function getFileNameWithoutExt(fileName: string): string {
    return fileName.replace(/\.f(ast)?q.*$/i, '');
  }

  function getSharedSampleIdFromPair(r1Name?: string, r2Name?: string): string | null {
    const r1SampleId = getSampleIdFromRFileName(r1Name || '');
    const r2SampleId = getSampleIdFromRFileName(r2Name || '');
    return r1SampleId || r2SampleId;
  }

  function setDropzoneActive(val: boolean) {
    isDropzoneActive.value = val;
  }

  async function startUploadProcess() {
    clearErrorsFromFiles(filesNotUploaded.value);
    initializeProgressForFiles(filesNotUploaded.value);
    removeStoredSampleSheetInfo();

    // pre-upload work - catch and handle errors in this step with applyErrorToFiles
    try {
      const uploadManifest = await getUploadFilesManifest(filesNotUploaded.value);
      addUploadUrls(uploadManifest);
    } catch (error: any) {
      applyErrorToFiles(filesNotUploaded.value, error.message);
      return;
    }

    await uploadFiles();

    await postUploadHook();
  }

  async function postUploadHook() {
    if (filesNotUploaded.value.length === 0) {
      await saveSampleSheetInfo();
    }
  }

  async function saveSampleSheetInfo() {
    uiStore.setRequestPending('generateSampleSheet');

    try {
      // get manifest of all files
      const uploadManifest = await getUploadFilesManifest(files.value);

      const uploadedFilePairs: UploadedFilePairInfo[] = getUploadedFilePairs(uploadManifest);
      // get sample sheet info
      const sampleSheetResponse: SampleSheetResponse = await getSampleSheetCsv(uploadedFilePairs);

      // save to wip run
      const { S3Url, Bucket, Path } = sampleSheetResponse.SampleSheetInfo;

      wipRunUpdateFunction.value(props.wipRunTempId, {
        sampleSheetS3Url: S3Url,
        s3Bucket: Bucket,
        s3Path: Path,
      });
      wipRunUpdateParamsFunction.value(props.wipRunTempId, {
        input: S3Url,
        outdir: `s3://${Bucket}/${Path}/results`,
      });
    } finally {
      uiStore.setRequestComplete('generateSampleSheet');
    }
  }

  function getUploadedFilePairs(uploadManifest: FileUploadManifest): UploadedFilePairInfo[] {
    const uploadedFilePairs: UploadedFilePairInfo[] = [];

    uploadManifest.Files.forEach((file: FileUploadInfo) => {
      const { Bucket, Key, Name, Region } = file;

      const uploadFileInfo: UploadedFileInfo = {
        Bucket,
        Key,
        Region,
      };

      const sampleId = getSampleIdFromRFileName(Name);
      const fileName = getFileNameWithoutExt(Name);

      // handle files without R values
      if (!sampleId) {
        // file does not have an R_ value, so it must be a single file, and cannot be paired
        // make a new pair with just this file as R1
        uploadedFilePairs.push({
          SampleId: fileName,
          R1: uploadFileInfo,
        });
        return;
      }

      const existingFilePair = uploadedFilePairs.find(
        (filePair) =>
          getSharedSampleIdFromPair(filePair.R1?.Key?.split('/').at(-1), filePair.R2?.Key?.split('/').at(-1)) ===
          sampleId,
      );
      if (existingFilePair) {
        if (Name.includes('_R1_')) {
          existingFilePair.R1 = uploadFileInfo;
        } else if (Name.includes('_R2_')) {
          existingFilePair.R2 = uploadFileInfo;
        }

        if (!existingFilePair.R1 || !existingFilePair.R2) {
          // individual files should use the fileName, so that _R1_s can be used as single files
          existingFilePair.SampleId = fileName;
        } else {
          // paired files should use the shared sampleId
          existingFilePair.SampleId = sampleId;
        }
      } else {
        const newFilePair: UploadedFilePairInfo = {
          SampleId: fileName, // as above, individual files should use the fileName
          R1: Name.includes('_R1_') ? uploadFileInfo : undefined,
          R2: Name.includes('_R2_') ? uploadFileInfo : undefined,
        };
        uploadedFilePairs.push(newFilePair);
      }
    });

    return uploadedFilePairs;
  }

  async function getSampleSheetCsv(uploadedFilePairs: UploadedFilePairInfo[]): Promise<SampleSheetResponse> {
    if (!wipRun.value.transactionId) throw new Error('no transaction id on wip run');

    const sampleSheetName: string = wipRun.value.runName
      ? `samplesheet-${wipRun.value.runName}.csv`
      : 'samplesheet.csv';

    const request: SampleSheetRequest = {
      SampleSheetName: sampleSheetName,
      LaboratoryId: props.labId,
      TransactionId: wipRun.value.transactionId,
      Platform: props.platform,
      UploadedFilePairs: uploadedFilePairs,
    };

    return await $api.uploads.getSampleSheetCsv(request);
  }

  async function getUploadFilesManifest(files: FileDetails[]): Promise<FileUploadManifest> {
    if (!wipRun.value.transactionId) throw new Error('no transaction id on wip run');

    const request: FileUploadRequest = {
      LaboratoryId: props.labId,
      TransactionId: wipRun.value.transactionId,
      Platform: props.platform,
      Files: files.map((file) => ({ Name: file.name, Size: file.size })),
    };

    return await $api.uploads.getFileUploadManifest(request);
  }

  function addUploadUrls(uploadManifest: FileUploadManifest) {
    for (const file of files.value) {
      const url = uploadManifest.Files.find((manifestFile) => manifestFile.Name === file.name)?.S3Url;
      if (url) file.url = url;
    }
  }

  /**
   * Handles the process of uploading multiple files, tracks their progress, and manages upload results.
   *
   * @returns {Promise<UploadError[]>} - Resolves with an array of failed uploads (if any), containing error details.
   *
   * Purpose:
   * - Initiates the upload of all files in `filesNotUploaded` using `uploadFile`.
   * - Ensures that all file uploads are completed, regardless of individual successes or failures, using `Promise.allSettled`.
   * - Collects detailed information about any failed uploads, including user-friendly error messages.
   * - Displays meaningful toast notifications for both successful and failed uploads:
   *   - Displays a success toast when all files are uploaded successfully.
   *   - Displays specific error messages for network errors or generic messages for multiple failed files.
   * - Creates and submits a lab run request upon successful uploads.
   *
   * Toast Messaging:
   * - For network errors, displays a detailed user-friendly message.
   * - For other failures, displays specific error messages for individual files or a summary for multiple failed files.
   */
  async function uploadFiles(): Promise<UploadError[]> {
    try {
      const uploadPromises = Object.values(filesNotUploaded.value).map((fileDetails) =>
        uploadFile(fileDetails)
          .then(() => null)
          .catch((error) => ({
            fileName: fileDetails.fileName,
            error: error.message,
          })),
      );

      const results = await Promise.allSettled(uploadPromises);
      const errors = results
        .map((result) => (result.status === 'rejected' ? result.reason : result.value))
        .filter((error): error is UploadError => error !== null);

      // Show other error toasts as needed
      if (errors.length > 0) {
        if (errors.length === 1) {
          toastStore.error(`Upload failed for ${errors[0].fileName}`);
        } else {
          toastStore.error(`Upload failed for ${errors.length} files`);
        }
      }

      return errors;
    } catch (error) {
      return [];
    }
  }

  /**
   * Uploads a single file to the specified URL using an HTTP PUT request.
   *
   * @param {FileDetails} fileDetails - An object containing file information, including the file, URL, and progress details.
   *
   * @returns {Promise} - Resolves with the response if the upload is successful.
   *                      Rejects with an error object containing the error message, code, and file details if the upload fails.
   *
   * Purpose:
   * - Tracks the progress of the file upload and updates progress in `fileDetails`.
   * - Handles network errors, rejecting with a detailed error message.
   * - Logs any upload errors to the console for debugging purposes.
   */

  async function uploadFile(fileDetails: FileDetails): Promise<void> {
    if (!fileDetails.url) {
      throw new Error('No upload URL provided');
    }

    const controller = new AbortController();
    // Store the controller
    uploadControllers.value[fileDetails.name] = controller;

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, UPLOAD_TIMEOUT);

    // Check network connection before starting upload
    if (!isOnline.value) {
      clearTimeout(timeoutId);
      fileDetails.error = 'No internet connection available';
      throw new Error('No internet connection available');
    }

    // Watch for network drops
    const unwatch = watch(
      isOnline,
      (online) => {
        if (!online) {
          // Immediately abort the upload and show error
          fileDetails.error = 'Network connection lost. Upload aborted.';
          controller.abort();
          unwatch();
        }
      },
      { flush: 'sync' },
    );

    try {
      const response = await axios.put(fileDetails.url, fileDetails.file, {
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            fileDetails.progress = progress;
          }
        },
      });

      clearTimeout(timeoutId);
      unwatch();
      // Remove the controller after successful upload
      delete uploadControllers.value[fileDetails.name];
      return response.data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      unwatch();
      // Remove the controller after failed upload
      delete uploadControllers.value[fileDetails.name];

      if (error.name === 'AbortError' || error.message === 'Network Error' || !isOnline.value) {
        fileDetails.error = 'Network connection lost. Upload aborted.';
        // Remove toast from here
        throw new Error('Network connection lost');
      }

      fileDetails.error = 'Upload failed. Please try again.';
      // Keep this toast as it's specific to the file
      toastStore.error('Upload failed. Please try again.');
      throw new Error('Upload failed. Please try again.');
    }
  }

  // Cancel upload for a specific file
  const cancelUpload = (fileName: string) => {
    const controller = uploadControllers.value[fileName];
    if (controller) {
      controller.abort();
      delete uploadControllers.value[fileName];
    }
  };

  const retryUpload = async (fileSelector: { sampleId: string; fileName: string }) => {
    // find file by filename
    let fileToRetry: FileDetails | undefined = files.value.find((file) => file.name === fileSelector.fileName);

    if (!fileToRetry) {
      throw new Error(`no fileToRetry found with name '${fileSelector.fileName}'`);
    }

    clearErrorsFromFiles([fileToRetry]);
    initializeProgressForFiles([fileToRetry]);
    removeStoredSampleSheetInfo();

    try {
      // pre-upload work - catch and handle errors in this step with applyErrorToFiles
      try {
        // Get fresh upload URL
        const manifest = await getUploadFilesManifest([fileToRetry]);
        const fileInfo = manifest.Files.find((f) => f.Name === fileToRetry!.name);
        if (!fileInfo) {
          throw new Error('file not found in manifest');
        }

        fileToRetry.url = fileInfo.S3Url;
      } catch (error: any) {
        applyErrorToFiles([fileToRetry], error.message);
        throw error;
      }

      await uploadFile(fileToRetry);

      await postUploadHook();
    } catch (error: any) {
      toastStore.error(`Failed to retry upload`);
    }
  };

  const removeFile = (file: { sampleId: string; fileName: string }) => {
    // Find the file pair containing the file
    const filePair = filePairs.value.find((pair) => pair.sampleId === file.sampleId);
    if (!filePair) return;

    // Remove only the specific file (r1 or r2) that matches the filename
    if (filePair.r1File?.name === file.fileName) {
      filePair.r1File = undefined;
    } else if (filePair.r2File?.name === file.fileName) {
      filePair.r2File = undefined;
    }

    // If both files are now undefined, remove the entire pair
    if (!filePair.r1File && !filePair.r2File) {
      setFiles(filePairs.value.filter((pair) => pair.sampleId !== file.sampleId));
    } else {
      // if there is still a file left in the pair, revert its sampleId to the fileName of the remaining file
      filePair.sampleId = getFileNameWithoutExt((filePair.r1File || filePair.r2File)!.name);
    }

    // remove the sample sheet because it's outdated now
    removeStoredSampleSheetInfo();
  };

  const canRetryUpload = (row: { sampleId: string; fileName: string; progress: number; error?: string }) => {
    // If the file isn't in error state, can't retry
    if (!row.error) return false;

    // if there's a problem with the selected files, that needs to be addressed before uploading
    if (filesProblemAlertMessage.value !== null) return false;

    return true;
  };

  watch(canProceedToNextStep, (val) => {
    emit('step-validated', val);
  });
</script>

<template>
  <EGCard>
    <EGText tag="small" class="mb-4">Step 02</EGText>
    <EGText tag="h4" class="mb-4">Upload Data</EGText>
    <p class="text-muted mt-1 text-xs font-normal tracking-tight">
      Any similar files with the suffix _R1 or _R2 will be combined as paired-end data samples. Max file size is 5GB.
      <button
        type="button"
        class="text-primary ml-1 underline hover:opacity-80"
        @click="showAdvancedOptions = !showAdvancedOptions"
      >
        {{ showAdvancedOptions ? 'Collapse advanced options' : 'View advanced options' }}
      </button>
    </p>

    <div v-if="showAdvancedOptions" class="mt-4">
      <UDivider />
      <label class="text-body mb-1 mt-4 block text-sm font-medium">Sample ID split pattern</label>
      <UInput v-model="sampleIdSplitPattern" class="w-64" />
      <p class="text-muted mb-4 mt-1 text-xs">
        Enter the character or pattern that appears after the Sample ID in your file names (e.g. _S, _L001, etc.).
      </p>
    </div>

    <UDivider class="py-4" />
    <div
      class="py-4"
      @drop.prevent="handleDroppedFiles"
      :class="{ 'pointer-events-none opacity-50': !isDropzoneEnabled }"
    >
      <div
        id="dropzone"
        @dragenter.prevent="setDropzoneActive(true)"
        @dragleave.prevent="setDropzoneActive(false)"
        @dragover.prevent
        @drop.prevent="setDropzoneActive(false)"
      >
        <div
          :class="
            cn(
              'ring-primary-500 text-body flex w-full items-center justify-center rounded-lg py-8 ring-2 ring-offset-1 transition-colors duration-200',
              {
                'bg-alert-success-muted ring-alert-success font-semibold ring-offset-2': isDropzoneActive,
              },
            )
          "
        >
          <div class="flex items-center justify-center">
            <div>
              <span :class="cn('visible', { 'invisible': isDropzoneActive })">Drag and&nbsp;</span>
              <span v-if="isDropzoneActive">Drop</span>
              <span v-else>drop</span>
              your files
              <span :class="cn('visible', { 'invisible': isDropzoneActive })">here or</span>
            </div>
            <input
              accept=".gz,.fastq"
              ref="chooseFilesButton"
              type="file"
              id="dropzoneFiles"
              @change="handleFileInputChange"
              hidden
              multiple
            />
            <EGButton
              :disabled="!isDropzoneEnabled"
              :class="cn('visible ml-4', { 'invisible': isDropzoneActive })"
              @click="chooseFiles"
              label="Choose Files"
              size="sm"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="files-list mb-6" v-if="filesForTable.length > 0">
      <div class="files-list-header text-body mb-4 border-b border-[#d9d9d9]">
        <div class="file-cell sample-id flex w-[30%] min-w-[240px]">Sample ID</div>
        <div class="file-cell flex w-[60%] min-w-[320px]">Sample File</div>
        <div class="file-cell flex w-[10%] min-w-[70px]"></div>
      </div>
      <div class="files-list-body">
        <div
          v-for="(row, index) in filesForTable"
          :key="row.fileName"
          class="file-row"
          :style="{
            background: row.error
              ? '#FFF2F0'
              : row.progress === 100
                ? '#E2FBE8'
                : row.progress !== undefined && row.progress > 0
                  ? `linear-gradient(to right, #E2FBE8 ${row.progress}%, transparent ${Math.min(row.progress + 10, 100)}%), #f7f7f7`
                  : '#f7f7f7',
          }"
        >
          <div class="file-cell sample-id text-body flex w-[30%] min-w-[240px] items-center">
            <div v-if="!row.error" class="truncate">{{ row.sampleId }}</div>
            <div v-else class="text-alert-danger-dark mr-1 truncate font-medium">(Upload Failed)</div>
          </div>
          <div
            class="file-cell flex w-[60%] min-w-[320px] items-center"
            :style="{ color: row.progress === 100 && !row.error ? '#306239' : 'inherit' }"
          >
            <template v-if="row.error">
              <UIcon name="i-heroicons-exclamation-triangle" class="text-alert-danger-dark mr-2" size="20" />
            </template>
            <div class="truncate">{{ row.fileName }}</div>
          </div>

          <div class="file-cell flex w-[10%] min-w-[70px] items-center justify-end gap-4">
            <!-- retry button -->
            <button
              v-if="row.error"
              class="flex items-center"
              :class="[canRetryUpload(row) ? 'text-gray-900 hover:text-gray-700' : 'cursor-not-allowed text-gray-400']"
              @click="retryUpload(row)"
              :disabled="!isOnline || !canRetryUpload(row)"
            >
              <UIcon name="i-heroicons-arrow-path" size="20" />
            </button>

            <!-- complete check -->
            <UIcon
              v-if="!row.error && row.progress === 100"
              size="20"
              name="i-heroicons-check"
              class="text-alert-success-text"
            />

            <!-- cancel upload button -->
            <button
              v-if="!row.error && row.progress && row.progress < 100"
              class="flex items-center text-gray-500 hover:text-gray-700"
              @click="cancelUpload(row.fileName)"
            >
              <UIcon name="i-heroicons-x-mark" size="20" />
            </button>

            <!-- delete button -->
            <button
              class="flex items-center"
              :disabled="!isOnline || uploadStatus === 'uploading'"
              :class="[
                isOnline && uploadStatus !== 'uploading'
                  ? 'text-alert-danger hover:text-alert-danger-dark'
                  : 'cursor-not-allowed text-gray-400',
              ]"
              @click="removeFile(row)"
            >
              <UIcon name="i-heroicons-trash" size="20" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="filesProblemAlertMessage"
      class="bg-alert-danger-muted text-alert-danger my-10 flex items-center gap-2 rounded-lg p-6"
    >
      <UIcon class="text-2xl" name="i-heroicons-exclamation-triangle" />
      <div>{{ filesProblemAlertMessage }}</div>
    </div>

    <EGS3SampleSheetBar
      v-if="wipRun.sampleSheetS3Url || uiStore.isRequestPending('generateSampleSheet')"
      :disabled="uploadStatus === 'uploading'"
      :url="wipRun.sampleSheetS3Url"
      :lab-id="props.labId"
      :lab-name="labName"
      :pipeline-or-workflow-name="props.pipelineOrWorkflowName"
      :platform="platform"
      :run-name="wipRun.runName"
      :display-label="true"
    />

    <div class="flex justify-end gap-4 pt-4">
      <EGButton
        v-if="showGenerateSampleSheetButton"
        @click="saveSampleSheetInfo"
        :loading="uiStore.isRequestPending('generateSampleSheet')"
        label="Generate Sample Sheet"
        variant="secondary"
      />

      <EGButton
        @click="startUploadProcess"
        :disabled="isUploadButtonDisabled"
        :loading="uploadStatus === 'uploading'"
        label="Upload Files"
      />
    </div>
  </EGCard>

  <div class="mt-6 flex justify-between">
    <EGButton :size="ButtonSizeEnum.enum.sm" variant="secondary" label="Previous step" @click="emit('previous-step')" />
    <EGButton
      v-if="filePairs.length"
      :size="ButtonSizeEnum.enum.sm"
      variant="primary"
      label="Next step"
      @click="emit('next-step')"
      :disabled="!canProceedToNextStep"
    />
    <EGButton v-else :size="ButtonSizeEnum.enum.sm" variant="primary" label="Skip" @click="emit('next-step')" />
  </div>
</template>

<style lang="scss">
  .files-list {
    padding: 0;

    &-header {
      display: flex;
      padding: 12px 16px;
      font-size: 14px;

      .header-cell {
        flex: 1;
        font-weight: 500;
      }
    }

    &-body {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .file-row {
        display: flex;
        padding: 14px 16px;
        border-radius: 6px;
        transition: background 0.3s ease-out;

        .file-cell {
          font-size: 14px;

          &.sample-id {
            font-weight: 500;
          }
        }
      }
    }
  }
</style>
