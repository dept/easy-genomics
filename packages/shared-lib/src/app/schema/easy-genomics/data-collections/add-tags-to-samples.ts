import { z } from 'zod';

export const AddTagsToSamplesSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SampleIds: z.array(z.string().uuid()).min(1).max(500),
    AddTagIds: z.array(z.string().uuid()).max(50).optional(),
    RemoveTagIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export const RequestListSampleTagsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SampleIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();
