import { z } from 'zod';
import { SequenceSetLayoutSchema } from './create-sequence-set';
import { SEQUENCE_SET_NAME_MAX_LENGTH } from '../../../constants/data-collections';

const CopyJobSchema = z
  .object({
    SourceBucket: z.string().min(1),
    SourceKey: z.string().min(1),
    DestKey: z.string().min(1),
  })
  .strict();

const BulkSequenceSetItemSchema = z
  .object({
    Name: z.string().trim().min(1).max(SEQUENCE_SET_NAME_MAX_LENGTH),
    Layout: SequenceSetLayoutSchema,
    Keys: z.array(z.string().min(1)).min(1).max(50),
    TagIds: z.array(z.string().uuid()).max(20).optional(),
    FilenameRegex: z.string().trim().min(1).optional(),
    SampleIdPattern: z.string().trim().min(1).optional(),
  })
  .strict();

export const BulkCreateSequenceSetsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    ImportLabel: z.string().trim().min(1).max(250),
    SequenceSets: z.array(BulkSequenceSetItemSchema).min(1).max(500),
    CopyJobs: z.array(CopyJobSchema).max(2000).optional(),
  })
  .strict();
