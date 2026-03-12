// request-folder-download-job-status API type definition
import { FolderDownloadJobStatus } from './request-folder-download-job';

export type RequestFolderDownloadJobStatus = {
  LaboratoryId: string;
  JobId: string;
};

export type FolderDownloadJobStatusResponse = {
  JobId: string;
  Status: FolderDownloadJobStatus;
  DownloadUrl?: string;
  ErrorMessage?: string;
};
