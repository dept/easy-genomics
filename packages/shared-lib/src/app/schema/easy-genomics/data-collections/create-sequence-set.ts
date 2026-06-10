import { z } from 'zod';
import { SEQUENCE_SET_NAME_MAX_LENGTH } from '../../../constants/data-collections';

export const SequenceSetLayoutSchema = z.enum(['paired_end', 'single_end', 'long_reads', 'paired_end_with_extras']);

export const CreateSequenceSetSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    /** Create a new sequence set with this name. Omit when adding to ExistingSequenceSetId. */
    Name: z.string().trim().min(1).max(SEQUENCE_SET_NAME_MAX_LENGTH).optional(),
    Layout: SequenceSetLayoutSchema,
    FilenameRegex: z.string().trim().min(1).optional(),
    SampleIdPattern: z.string().trim().min(1).optional(),
    /** S3 keys to attach. Required unless ExistingSequenceSetId with regex expansion supplies keys. */
    Keys: z.array(z.string().min(1)).max(500).optional(),
    /** When set, attach Keys to this existing sequence set instead of creating a new one. */
    ExistingSequenceSetId: z.string().uuid().optional(),
    /** Optional extra keys from lab listing matching FilenameRegex (server-side expansion). */
    ExpandRegexFromListing: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.ExistingSequenceSetId && !data.Name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Name'],
        message: 'Name is required when creating a new sequence set',
      });
    }
    if (!data.Keys?.length && !data.ExistingSequenceSetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Keys'],
        message: 'At least one file key is required',
      });
    }
  });

export const AddFilesToSequenceSetSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    SequenceSetId: z.string().uuid(),
    Keys: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();

export const RemoveFilesFromSequenceSetSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    SequenceSetId: z.string().uuid(),
    Keys: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();
