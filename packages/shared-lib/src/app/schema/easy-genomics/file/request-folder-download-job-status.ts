import { z } from 'zod';

// request-folder-download-job-status API request validation schemas
export const RequestFolderDownloadJobStatusSchema = z
  .object({
    LaboratoryId: z.string(),
    JobId: z.string().uuid(),
  })
  .strict();

export const FolderDownloadJobStatusResponseSchema = z
  .object({
    JobId: z.string().uuid(),
    Status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
    DownloadUrl: z.string().optional(),
    ErrorMessage: z.string().optional(),
  })
  .strict();
