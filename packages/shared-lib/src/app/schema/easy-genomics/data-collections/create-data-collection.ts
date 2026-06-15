import { z } from 'zod';
import { SampleSheetColumnDefSchema } from './sample-sheet-column-def';
import { RUN_DATA_COLLECTION_NAME_MAX_LENGTH } from '../../../constants/data-collections';

export const CreateDataCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    /** Create a new data collection with this name. Omit when adding to ExistingDataCollectionId. */
    Name: z.string().trim().min(1).max(RUN_DATA_COLLECTION_NAME_MAX_LENGTH).optional(),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
    /** Sequence set ids to attach. Required when creating; optional when adding to existing. */
    SequenceSetIds: z.array(z.string().uuid()).max(500).optional(),
    ExistingDataCollectionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.ExistingDataCollectionId && !data.Name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['Name'],
        message: 'Name is required when creating a new data collection',
      });
    }
    if (!data.ExistingDataCollectionId && !data.SequenceSetIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SequenceSetIds'],
        message: 'At least one sequence set is required when creating a data collection',
      });
    }
  });

export const AddSequenceSetsToDataCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    DataCollectionId: z.string().uuid(),
    SequenceSetIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export const UpdateDataCollectionSchemaSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    DataCollectionId: z.string().uuid(),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
  })
  .strict();

export const UpdateDataCollectionSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    DataCollectionId: z.string().uuid(),
    Name: z.string().trim().min(1).max(RUN_DATA_COLLECTION_NAME_MAX_LENGTH),
    Columns: z.array(SampleSheetColumnDefSchema).min(1).max(30),
    SequenceSetIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export const GenerateDataCollectionSampleSheetSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    DataCollectionId: z.string().uuid(),
    /** Platform folder segment for sample sheet S3 path. */
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    TransactionId: z.string().uuid(),
    SampleSheetName: z.string().regex(/^[a-zA-Z0-9._:!@#$%^()-]+\.csv$/, 'Invalid sample sheet name'),
    /** When true, validate that referenced S3 objects exist. */
    ValidateS3FilesExist: z.boolean().optional(),
  })
  .strict();
