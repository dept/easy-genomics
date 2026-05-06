import { z } from 'zod';

/** Exactly one of ClearBatch, BatchTagId, or NewBatchName must be set. */
export const AssignBatchSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    Keys: z.array(z.string().min(1)).min(1).max(100),
    ClearBatch: z.boolean().optional(),
    BatchTagId: z.string().min(1).optional(),
    NewBatchName: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const modes = [data.ClearBatch === true, !!data.BatchTagId, !!data.NewBatchName].filter(Boolean);
      return modes.length === 1;
    },
    { message: 'Specify exactly one of ClearBatch, BatchTagId, or NewBatchName' },
  );
