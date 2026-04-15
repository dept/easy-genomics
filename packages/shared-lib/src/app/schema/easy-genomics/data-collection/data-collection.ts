import { z } from 'zod';

// Limits enforced in backend (keep in sync with lambdas)
export const DATA_COLLECTION_MAX_TAGS_PER_FILE = 20;
export const DATA_COLLECTION_MAX_BATCH_KEYS = 100;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a #RRGGBB hex value');

export const ListDataCollectionTagsRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
  })
  .strict();

export const DataCollectionTagSchema = z.object({
  TagId: z.string(),
  Name: z.string(),
  Color: z.string(),
  CreatedAt: z.string().optional(),
  ModifiedAt: z.string().optional(),
});

export const ListDataCollectionTagsResponseSchema = z.object({
  Tags: z.array(DataCollectionTagSchema),
});

export const CreateDataCollectionTagRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Name: z.string().min(1).max(128),
    Color: hexColor,
  })
  .strict();

export const CreateDataCollectionTagResponseSchema = z.object({
  Tag: DataCollectionTagSchema,
});

export const UpdateDataCollectionTagRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    TagId: z.string().min(1),
    Name: z.string().min(1).max(128),
    Color: hexColor,
  })
  .strict();

export const UpdateDataCollectionTagResponseSchema = z.object({
  Tag: DataCollectionTagSchema,
});

export const DeleteDataCollectionTagRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    TagId: z.string().min(1),
  })
  .strict();

export const DeleteDataCollectionTagResponseSchema = z.object({
  Deleted: z.boolean(),
});

export const BatchGetDataCollectionFileTagsRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Keys: z.array(z.string().min(1)).min(1).max(DATA_COLLECTION_MAX_BATCH_KEYS),
  })
  .strict();

export const S3KeyTagAssignmentSchema = z.object({
  S3Key: z.string().min(1),
  TagIds: z.array(z.string().min(1)).max(DATA_COLLECTION_MAX_TAGS_PER_FILE),
});

export const BatchGetDataCollectionFileTagsResponseSchema = z.object({
  Assignments: z.array(S3KeyTagAssignmentSchema),
});

export const BatchSetDataCollectionFileTagsRequestSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Items: z.array(S3KeyTagAssignmentSchema).min(1).max(DATA_COLLECTION_MAX_BATCH_KEYS),
  })
  .strict();

export const BatchSetDataCollectionFileTagsResponseSchema = z.object({
  Updated: z.number().int().nonnegative(),
});
