import { z } from 'zod';

// request-folder-download-job API request validation schemas
export const FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT = 2000;

export const RequestFolderDownloadJobSchema = z
  .object({
    LaboratoryId: z.string(),
    S3Bucket: z.string().optional(),
    S3Prefix: z.string().min(1),
    /** When set, zip these keys instead of every object under S3Prefix. */
    ObjectKeys: z.array(z.string().min(1).max(1024)).min(1).max(FOLDER_DOWNLOAD_OBJECT_KEYS_LIMIT).optional(),
    /** Zip root folder name for a filtered key-outputs archive. */
    ArchiveName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const FolderDownloadJobResponseSchema = z
  .object({
    JobId: z.string(),
    Status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  })
  .strict();
