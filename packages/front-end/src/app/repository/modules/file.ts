import { FileDownloadUrlResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-file-download-url';
import { FolderDownloadJobResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job';
import { FolderDownloadJobStatusResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job-status';
import { S3ResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-list-bucket-objects';
import { S3SearchResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-search-bucket-objects';
import { S3TopLevelResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-top-level-bucket-objects';
import {
  RequestFileDownloadUrl,
  FileDownloadUrlResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-file-download-url';
import {
  FolderDownloadJobResponse,
  RequestFolderDownloadJob,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-folder-download-job';
import {
  FolderDownloadJobStatusResponse,
  RequestFolderDownloadJobStatus,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-folder-download-job-status';
import {
  RequestListBucketObjects,
  S3Response,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';
import {
  RequestSearchBucketObjects,
  S3SearchResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-search-bucket-objects';
import {
  RequestTopLevelBucketObjects,
  S3TopLevelResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';
import { FileDownloadResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/file/request-file-download';
import HttpFactory from '@FE/repository/factory';
import { validateApiResponse } from '@FE/utils/api-utils';

class FileModule extends HttpFactory {
  /**
   * Request file download URL
   * @param req
   */
  async requestFileDownloadUrl(req: RequestFileDownloadUrl): Promise<FileDownloadUrlResponse> {
    const res = await this.call<FileDownloadUrlResponse>('POST', '/file/request-file-download-url', req);

    if (!res) {
      console.error('Error calling file download API');
      throw new Error('Failed to perform file download');
    }
    validateApiResponse(FileDownloadUrlResponseSchema, res);
    return res;
  }

  /**
   * Create asynchronous folder download job
   * @param req
   */
  async requestFolderDownloadJob(req: RequestFolderDownloadJob): Promise<FolderDownloadJobResponse> {
    const res = await this.call<FolderDownloadJobResponse>('POST', '/file/request-folder-download-job', req);

    if (!res) {
      console.error('Error calling folder download job API');
      throw new Error('Failed to create folder download job');
    }
    validateApiResponse(FolderDownloadJobResponseSchema, res);
    return res;
  }

  /**
   * Request asynchronous folder download job status
   * @param req
   */
  async requestFolderDownloadJobStatus(req: RequestFolderDownloadJobStatus): Promise<FolderDownloadJobStatusResponse> {
    const res = await this.call<FolderDownloadJobStatusResponse>(
      'POST',
      '/file/request-folder-download-job-status',
      req,
    );

    if (!res) {
      console.error('Error calling folder download job status API');
      throw new Error('Failed to request folder download job status');
    }
    validateApiResponse(FolderDownloadJobStatusResponseSchema, res);
    return res;
  }

  /**
   * Request list of objects in an S3 bucket
   * @param req
   */
  async requestListBucketObjects(req: RequestListBucketObjects): Promise<S3Response> {
    const res = await this.call<S3Response>('POST', '/file/request-list-bucket-objects', req);

    if (!res) {
      console.error('Error calling file download API');
      throw new Error('Failed to perform file download');
    }

    validateApiResponse(S3ResponseSchema, res);
    return res;
  }

  /**
   * Request top-level objects (direct children only) at an S3 prefix for lazy-loading
   * @param req
   */
  async requestTopLevelBucketObjects(req: RequestTopLevelBucketObjects): Promise<S3TopLevelResponse> {
    const res = await this.call<S3TopLevelResponse>('POST', '/file/request-top-level-bucket-objects', req);

    if (!res) {
      console.error('Error calling top-level bucket objects API');
      throw new Error('Failed to fetch top-level bucket objects');
    }

    validateApiResponse(S3TopLevelResponseSchema, res);
    return res;
  }

  /**
   * Search objects in an S3 bucket prefix and return matching files
   * @param req
   */
  async requestSearchBucketObjects(req: RequestSearchBucketObjects): Promise<S3SearchResponse> {
    const res = await this.call<S3SearchResponse>('POST', '/file/request-search-bucket-objects', req);

    if (!res) {
      console.error('Error calling search bucket objects API');
      throw new Error('Failed to search bucket objects');
    }

    validateApiResponse(S3SearchResponseSchema, res);
    return res;
  }

  /**
   * Get signed URL for downloading a file from an S3 Bucket
   * @param labId
   * @param contentUri
   */
  async fetchPresignedS3Url(labId: string, contentUri: string): Promise<FileDownloadResponse> {
    const res: FileDownloadResponse | undefined = await this.call<FileDownloadResponse>(
      'POST',
      '/file/request-file-download-url',
      {
        LaboratoryId: labId,
        S3Uri: contentUri,
      },
    );

    if (!res) {
      console.error('Error calling file download API');
      throw new Error('Failed to perform file download');
    }

    validateApiResponse(FileDownloadUrlResponseSchema, res);
    return res;
  }
}

export default FileModule;
