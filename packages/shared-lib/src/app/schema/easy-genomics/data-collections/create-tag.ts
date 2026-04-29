import { z } from 'zod';

export const ColorHexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a #RRGGBB hex value');

export const CreateLaboratoryDataTagSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Name: z.string().trim().min(1).max(128),
    ColorHex: ColorHexSchema,
  })
  .strict();
