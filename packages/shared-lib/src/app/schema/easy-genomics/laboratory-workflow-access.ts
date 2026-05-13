import { z } from 'zod';

const batchAssignmentSchema = z.object({
  laboratoryId: z.string().min(1),
  platform: z.enum(['HEALTH_OMICS', 'SEQERA']),
  workflowId: z.string().min(1),
  workflowName: z.string().optional(),
  granted: z.boolean(),
});

export const BatchUpdateLaboratoryWorkflowAccessRequestSchema = z.object({
  assignments: z.array(batchAssignmentSchema),
});

export type BatchUpdateLaboratoryWorkflowAccessRequestValidated = z.infer<
  typeof BatchUpdateLaboratoryWorkflowAccessRequestSchema
>;
