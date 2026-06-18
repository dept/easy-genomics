import { z } from 'zod';
import { SampleSheetColumnDefSchema } from './sample-sheet-column-def';
import { SEQUENCE_COLLECTION_NAME_MAX_LENGTH } from '../../../constants/data-collections';

export const CreateSequenceCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    /** Create a new sequence collection with this name. Omit when adding to ExistingSequenceCollectionId. */
    Name: z.string().trim().min(1).max(SEQUENCE_COLLECTION_NAME_MAX_LENGTH).optional(),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
    /** Sample ids to attach. Required when creating; optional when adding to existing. */
    SampleIds: z.array(z.string().uuid()).max(500).optional(),
    ExistingSequenceCollectionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.ExistingSequenceCollectionId && !data.Name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Name'],
        message: 'Name is required when creating a new data collection',
      });
    }
    if (!data.ExistingSequenceCollectionId && !data.SampleIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SampleIds'],
        message: 'At least one sample is required when creating a sequence collection',
      });
    }
  });

export const AddSamplesToSequenceCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SequenceCollectionId: z.string().uuid(),
    SampleIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export const UpdateSequenceCollectionSchemaSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SequenceCollectionId: z.string().uuid(),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
  })
  .strict();

export const UpdateSequenceCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SequenceCollectionId: z.string().uuid(),
    Name: z.string().trim().min(1).max(SEQUENCE_COLLECTION_NAME_MAX_LENGTH),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
    SampleIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export const GenerateSequenceCollectionSampleSheetSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    SequenceCollectionId: z.string().uuid(),
    /** Platform folder segment for sample sheet S3 path. */
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    TransactionId: z.string().uuid(),
    SampleSheetName: z.string().regex(/^[a-zA-Z0-9._:!@#$%^()-]+\.csv$/, 'Invalid sample sheet name'),
    /** When true, validate that referenced S3 objects exist. */
    ValidateS3FilesExist: z.boolean().optional(),
  })
  .strict();
