// request-folder-download-job API type definition
export type RequestFolderDownloadJob = {
  LaboratoryId: string;
  S3Bucket?: string;
  S3Prefix: string;
};

export type FolderDownloadJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type FolderDownloadJobResponse = {
  JobId: string;
  Status: FolderDownloadJobStatus;
};
