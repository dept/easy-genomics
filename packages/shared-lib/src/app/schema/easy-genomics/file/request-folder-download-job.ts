import { z } from 'zod';

// request-folder-download-job API request validation schemas
export const RequestFolderDownloadJobSchema = z
  .object({
    LaboratoryId: z.string(),
    S3Bucket: z.string().optional(),
    S3Prefix: z.string().min(1),
  })
  .strict();

export const FolderDownloadJobResponseSchema = z
  .object({
    JobId: z.string(),
    Status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  })
  .strict();
