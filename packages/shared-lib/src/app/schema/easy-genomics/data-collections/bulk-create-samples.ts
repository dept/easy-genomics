import { z } from 'zod';
import { SampleLayoutSchema } from './create-sample';
import { DATA_COLLECTION_BATCH_NAME_MAX_LENGTH, SAMPLE_NAME_MAX_LENGTH } from '../../../constants/data-collections';

const CopyJobSchema = z
  .object({
    SourceBucket: z.string().min(1),
    SourceKey: z.string().min(1),
    DestKey: z.string().min(1),
  })
  .strict();

const BulkSampleItemSchema = z
  .object({
    Name: z.string().trim().min(1).max(SAMPLE_NAME_MAX_LENGTH),
    Layout: SampleLayoutSchema,
    Keys: z.array(z.string().min(1)).min(1).max(50),
    TagIds: z.array(z.string().uuid()).max(20).optional(),
    FilenameRegex: z.string().trim().min(1).optional(),
    SampleIdPattern: z.string().trim().min(1).optional(),
  })
  .strict();

export const BulkCreateSamplesSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    ImportLabel: z.string().trim().min(1).max(250),
    Samples: z.array(BulkSampleItemSchema).min(1).max(500),
    CopyJobs: z.array(CopyJobSchema).max(2000).optional(),
    BatchTagId: z.string().min(1).optional(),
    NewBatchName: z.string().trim().min(1).max(DATA_COLLECTION_BATCH_NAME_MAX_LENGTH).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const modes = [!!data.BatchTagId, !!data.NewBatchName].filter(Boolean);
      return modes.length === 1;
    },
    { message: 'Specify exactly one of BatchTagId or NewBatchName' },
  );
