/**
 * Generated type aliases for the Easy Genomics API.
 *
 * Request types are derived from the OpenAPI spec (easy-genomics-api.yaml) via openapi-typescript.
 * Response types and nested utility types that are not represented in the spec remain hand-written.
 *
 * To update: regenerate the spec (generate:openapi), then regenerate types (generate:api-types).
 */
import type { components } from './generated';

// ─── File: request-file-download-url ─────────────────────────────────────────

export type RequestFileDownloadUrl = components['schemas']['RequestFileDownloadUrlRequest'];

export type FileDownloadUrlResponse = {
  DownloadUrl: string;
};

// ─── File: request-folder-download-job ───────────────────────────────────────

export type RequestFolderDownloadJob = components['schemas']['RequestFolderDownloadJobRequest'];

export type FolderDownloadJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type FolderDownloadJobResponse = {
  JobId: string;
  Status: FolderDownloadJobStatus;
};

// ─── File: request-folder-download-job-status ────────────────────────────────

export type RequestFolderDownloadJobStatus = components['schemas']['RequestFolderDownloadJobStatusRequest'];

export type FolderDownloadJobStatusResponse = {
  JobId: string;
  Status: FolderDownloadJobStatus;
  DownloadUrl?: string;
  ErrorMessage?: string;
};

// ─── File: request-list-bucket-objects ───────────────────────────────────────

export type RequestListBucketObjects = components['schemas']['RequestListBucketObjectsRequest'];

export interface S3Object {
  Key: string;
  LastModified: string;
  ETag: string;
  Size: number;
  StorageClass: string;
}

// AWS SDK S3 response passthrough — not representable in the OpenAPI spec.
export interface S3Response {
  $metadata: {
    httpStatusCode: number;
    requestId: string;
    extendedRequestId: string;
    attempts: number;
    totalRetryDelay: number;
  };
  Contents: S3Object[];
}

// ─── File: request-search-bucket-objects ─────────────────────────────────────

export type RequestSearchBucketObjects = components['schemas']['RequestSearchBucketObjectsRequest'];

export interface S3Prefix {
  Prefix: string;
}

// AWS SDK S3 response passthrough — not representable in the OpenAPI spec.
export interface S3SearchResponse {
  $metadata: {
    httpStatusCode: number;
    requestId: string;
    extendedRequestId: string;
    attempts: number;
    totalRetryDelay: number;
  };
  Contents: S3Object[];
  CommonPrefixes?: S3Prefix[];
  IsTruncated: boolean;
}

// ─── File: request-top-level-bucket-objects ──────────────────────────────────

export type RequestTopLevelBucketObjects = components['schemas']['RequestTopLevelBucketObjectsRequest'];

// AWS SDK S3 response passthrough — not representable in the OpenAPI spec.
export interface S3TopLevelResponse {
  $metadata: {
    httpStatusCode: number;
    requestId: string;
    extendedRequestId: string;
    attempts: number;
    totalRetryDelay: number;
  };
  Contents?: S3Object[];
  CommonPrefixes?: S3Prefix[];
  IsTruncated: boolean;
}

// ─── File: user-invitation ───────────────────────────────────────────────────

export type CreateUserInvitationRequest = components['schemas']['CreateUserInvitationRequestRequest'];

// SNS event payload — extends CreateUserInvitationRequest with CreatedBy; not an HTTP request type.
export interface QueuedUserInvitationRequest extends CreateUserInvitationRequest {
  CreatedBy: string;
}

export type CreateBulkUserInvitationRequest = components['schemas']['CreateBulkUserInvitationRequestsRequest'];

export type ConfirmUserInvitationRequest = components['schemas']['ConfirmUserInvitationRequestRequest'];

// ─── File: user-password ─────────────────────────────────────────────────────

export type CreateUserForgotPasswordRequest = components['schemas']['CreateUserForgotPasswordRequestRequest'];

export type ConfirmUserForgotPasswordRequest = components['schemas']['ConfirmUserForgotPasswordRequestRequest'];

// ─── File: upload/s3-file-upload-manifest ────────────────────────────────────

export type FileUploadRequest = components['schemas']['CreateFileUploadRequestRequest'];

export type FileInfo = {
  Name: string;
  Size: number;
};

// Response types for the file upload flow — not in the OpenAPI spec.
export type FileUploadPartInfo = {
  PartNo: number;
  Start: number;
  End: number;
  ETag?: string;
};

export type FileUploadInfo = {
  Name: string;
  Size: number;
  Bucket: string;
  Key: string;
  Region: string;
  S3Url: string;
  UploadId?: string;
  MultiParts?: FileUploadPartInfo[];
};

export type FileUploadManifest = {
  TransactionId: string;
  Files: FileUploadInfo[];
};

// ─── File: upload/s3-file-upload-sample-sheet ────────────────────────────────

// The generated spec has a self-referential R2 type and adds | null to R1/R2, breaking
// compatibility with UploadedFilePairInfo[]. Kept hand-written to preserve the clean shape.
export type SampleSheetRequest = {
  SampleSheetName: string;
  LaboratoryId: string;
  TransactionId: string;
  Platform: 'AWS HealthOmics' | 'Seqera Cloud';
  UploadedFilePairs: UploadedFilePairInfo[];
};

// Nested types for SampleSheetRequest/Response — kept hand-written for clarity.
export type UploadedFileInfo = {
  Bucket: string;
  Key: string;
  Region: string;
};

export type UploadedFilePairInfo = {
  SampleId: string;
  R1?: UploadedFileInfo;
  R2?: UploadedFileInfo;
};

export type SampleSheetInfo = {
  Name: string;
  Size: number;
  Checksum: string;
  Bucket: string;
  Path: string;
  Key: string;
  Region: string;
  S3Url: string;
  SampleSheetType: string;
};

export type SampleSheetResponse = {
  TransactionId: string;
  SampleSheetInfo: SampleSheetInfo;
};
