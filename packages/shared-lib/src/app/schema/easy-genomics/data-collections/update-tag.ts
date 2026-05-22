import { z } from 'zod';
import { ColorHexSchema } from './create-tag';
import { DATA_COLLECTION_BATCH_NAME_MAX_LENGTH } from '../../../constants/data-collections';

export const UpdateLaboratoryDataTagSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    Name: z.string().trim().min(1).max(DATA_COLLECTION_BATCH_NAME_MAX_LENGTH).optional(),
    ColorHex: ColorHexSchema.optional(),
  })
  .strict();
