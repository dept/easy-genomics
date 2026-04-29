import { z } from 'zod';

export const RequestListFileTagsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    /** Full S3 object keys (not URL-encoded). */
    Keys: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();
