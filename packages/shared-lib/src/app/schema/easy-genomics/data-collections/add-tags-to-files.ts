import { z } from 'zod';

export const AddTagsToFilesSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    S3Bucket: z.string().min(1),
    Keys: z.array(z.string().min(1)).min(1).max(100),
    AddTagIds: z.array(z.string().min(1)).optional(),
    RemoveTagIds: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((b) => (b.AddTagIds?.length ?? 0) > 0 || (b.RemoveTagIds?.length ?? 0) > 0, {
    message: 'At least one of AddTagIds or RemoveTagIds must be non-empty',
  });
