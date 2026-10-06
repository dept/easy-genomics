import { z } from 'zod';
import {
  WORKFLOW_KEY_OUTPUTS_LIMIT,
  WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH,
  WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH,
} from '../../types/easy-genomics/workflow-key-outputs';

const relativePathPattern = /^(?!\/)(?!.*\/\/).+$/;

export const WorkflowKeyOutputSchema = z
  .object({
    KeyOutputId: z.string().uuid(),
    Label: z.string().trim().min(1).max(WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH),
    Pattern: z
      .string()
      .trim()
      .min(1)
      .max(WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH)
      .regex(relativePathPattern, 'Pattern must be a relative path without a leading slash'),
    ExamplePath: z.string().min(1).max(WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH).optional(),
  })
  .strict();

export const WorkflowKeyOutputsSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    WorkflowName: z.string().min(1).optional(),
    Platform: z.string().min(1).optional(),
    SourceRunId: z.string().min(1).optional(),
    KeyOutputs: z.array(WorkflowKeyOutputSchema).max(WORKFLOW_KEY_OUTPUTS_LIMIT),
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

const EditableKeyOutputSchema = z
  .object({
    KeyOutputId: z.string().uuid().optional(),
    Label: z.string().trim().min(1).max(WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH),
    Pattern: z
      .string()
      .trim()
      .min(1)
      .max(WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH)
      .regex(relativePathPattern, 'Pattern must be a relative path without a leading slash'),
    ExamplePath: z.string().min(1).max(WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH).optional(),
  })
  .strict();

export const EditWorkflowKeyOutputsSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    WorkflowName: z.string().min(1).optional(),
    Platform: z.string().min(1).optional(),
    SourceRunId: z.string().min(1).optional(),
    KeyOutputs: z.array(EditableKeyOutputSchema).max(WORKFLOW_KEY_OUTPUTS_LIMIT),
  })
  .strict();
export type EditWorkflowKeyOutputs = z.infer<typeof EditWorkflowKeyOutputsSchema>;

export const RequestPreviewWorkflowKeyOutputsSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().min(1),
    ObjectKeys: z.array(z.string().min(1).max(1024)).max(WORKFLOW_KEY_OUTPUTS_LIMIT).optional(),
    KeyOutputs: z.array(EditableKeyOutputSchema).max(WORKFLOW_KEY_OUTPUTS_LIMIT).optional(),
  })
  .strict()
  .refine((value) => (value.ObjectKeys?.length ?? 0) > 0 || (value.KeyOutputs?.length ?? 0) > 0, {
    message: 'Provide ObjectKeys to infer patterns or KeyOutputs to score existing ones',
  });
export type RequestPreviewWorkflowKeyOutputs = z.infer<typeof RequestPreviewWorkflowKeyOutputsSchema>;
