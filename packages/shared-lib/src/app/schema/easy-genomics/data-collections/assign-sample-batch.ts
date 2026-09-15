import { z } from 'zod';
import { DATA_COLLECTION_BATCH_NAME_MAX_LENGTH } from '../../../constants/data-collections';

/** Exactly one of ClearBatch, BatchTagId, or NewBatchName must be set. */
export const AssignSampleBatchSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SampleIds: z.array(z.string().uuid()).min(1).max(100),
    ClearBatch: z.boolean().optional(),
    BatchTagId: z.string().min(1).optional(),
    NewBatchName: z.string().trim().min(1).max(DATA_COLLECTION_BATCH_NAME_MAX_LENGTH).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const modes = [data.ClearBatch === true, !!data.BatchTagId, !!data.NewBatchName].filter(Boolean);
      return modes.length === 1;
    },
    { message: 'Specify exactly one of ClearBatch, BatchTagId, or NewBatchName' },
  );
