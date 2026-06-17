import { z } from 'zod';

export const AddTagsToSequenceSetsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SequenceSetIds: z.array(z.string().uuid()).min(1).max(500),
    AddTagIds: z.array(z.string().uuid()).max(50).optional(),
    RemoveTagIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export const RequestListSequenceSetTagsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    SequenceSetIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();
