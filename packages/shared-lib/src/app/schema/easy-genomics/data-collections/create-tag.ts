import { z } from 'zod';
import {
  DATA_COLLECTION_BATCH_NAME_MAX_LENGTH,
  DATA_COLLECTION_TAG_NAME_MAX_LENGTH,
} from '../../../constants/data-collections';

export const ColorHexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a #RRGGBB hex value');

export const LaboratoryDataTagKindSchema = z.enum(['standard', 'batch']);

export const CreateLaboratoryDataTagSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Name: z.string().trim().min(1),
    ColorHex: ColorHexSchema,
    Kind: LaboratoryDataTagKindSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const kind = data.Kind ?? 'standard';
    const maxLength = kind === 'batch' ? DATA_COLLECTION_BATCH_NAME_MAX_LENGTH : DATA_COLLECTION_TAG_NAME_MAX_LENGTH;
    if (data.Name.length > maxLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: maxLength,
        type: 'string',
        inclusive: true,
        path: ['Name'],
        message: `Name must be at most ${maxLength} characters`,
      });
    }
  });
