import { z } from 'zod';
import { ColorHexSchema } from './create-tag';

export const UpdateLaboratoryDataTagSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Name: z.string().trim().min(1).max(128).optional(),
    ColorHex: ColorHexSchema.optional(),
  })
  .strict();
