import { z } from 'zod';

const batchAssignmentSchema = z.object({
  laboratoryId: z.string().min(1),
  bucketName: z.string().min(1),
  granted: z.boolean(),
});

export const BatchUpdateLaboratoryS3AccessRequestSchema = z.object({
  assignments: z.array(batchAssignmentSchema),
});

export type BatchUpdateLaboratoryS3AccessRequestValidated = z.infer<typeof BatchUpdateLaboratoryS3AccessRequestSchema>;
