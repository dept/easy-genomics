import { z } from 'zod';
import { SAMPLE_NAME_MAX_LENGTH } from '../../../constants/data-collections';

export const SampleLayoutSchema = z.enum(['paired_end', 'single_end', 'long_reads', 'paired_end_with_extras']);

export const CreateSampleSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    /** Create a new sample with this name. Omit when adding to ExistingSampleId. */
    Name: z.string().trim().min(1).max(SAMPLE_NAME_MAX_LENGTH).optional(),
    Layout: SampleLayoutSchema,
    FilenameRegex: z.string().trim().min(1).optional(),
    SampleIdPattern: z.string().trim().min(1).optional(),
    /** S3 keys to attach. Required unless ExistingSampleId with regex expansion supplies keys. */
    Keys: z.array(z.string().min(1)).max(500).optional(),
    /** When set, attach Keys to this existing sample instead of creating a new one. */
    ExistingSampleId: z.string().uuid().optional(),
    /** Optional extra keys from lab listing matching FilenameRegex (server-side expansion). */
    ExpandRegexFromListing: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.ExistingSampleId && !data.Name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Name'],
        message: 'Name is required when creating a new sample',
      });
    }
    if (!data.Keys?.length && !data.ExistingSampleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Keys'],
        message: 'At least one file key is required',
      });
    }
  });

export const AddFilesToSampleSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    SampleId: z.string().uuid(),
    Keys: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();

export const RemoveFilesFromSampleSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    SampleId: z.string().uuid(),
    Keys: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();
