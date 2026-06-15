import { z } from 'zod';

export const RequestUnlinkedBucketObjectsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    RelativePrefix: z.string().optional(),
    MaxTotalKeys: z.number().int().min(1).max(50000).optional(),
    MaxTransactionFolders: z.number().int().min(1).max(50000).optional(),
    MaxKeys: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
