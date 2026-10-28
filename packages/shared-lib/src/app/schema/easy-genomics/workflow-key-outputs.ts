import { z } from 'zod';
import {
  WORKFLOW_KEY_OUTPUTS_LIMIT,
  WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH,
  WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH,
} from '../../types/easy-genomics/workflow-key-outputs';
import {
  isProtectedLabDataDestination,
  parseKeyOutputDeliveryUri,
} from '../../utils/workflow-key-output-delivery';

function refineDeliveryDestination(
  value: { Enabled: boolean; DestinationUri?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.Enabled && !value.DestinationUri) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DestinationUri'],
      message: 'Enter an s3://bucket/prefix destination',
    });
  }
  if (!value.DestinationUri) return;
  const destination = parseKeyOutputDeliveryUri(value.DestinationUri);
  if (!destination) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DestinationUri'],
      message: 'Destination must be an s3://bucket or s3://bucket/prefix URI',
    });
    return;
  }
  if (isProtectedLabDataDestination(destination.prefix)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DestinationUri'],
      message: 'Destination cannot be an Easy Genomics laboratory data prefix',
    });
  }
}

const relativePathPattern = /^(?!\/)(?!.*\/\/).+$/;
const MAX_STARS_PER_SEGMENT = 4;

function refineKeyOutputPattern(pattern: string, ctx: z.RefinementCtx): void {
  if (pattern.includes('**')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '* matches inside one path segment. ** is not supported.',
    });
  }
  const crowded = pattern.split('/').some((segment) => segment.split('*').length - 1 > MAX_STARS_PER_SEGMENT);
  if (crowded) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Use at most ${MAX_STARS_PER_SEGMENT} * wildcards in a path segment.`,
    });
  }
}

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
  .strict()
  .superRefine((value, ctx) => refineKeyOutputPattern(value.Pattern, ctx));

export const WorkflowKeyOutputDeliverySchema = z
  .object({
    Enabled: z.boolean(),
    DestinationUri: z.string().trim().min(1).max(1024).optional(),
  })
  .strict()
  .superRefine(refineDeliveryDestination);

export const WorkflowKeyOutputsSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    WorkflowName: z.string().min(1).optional(),
    Platform: z.string().min(1).optional(),
    SourceRunId: z.string().min(1).optional(),
    KeyOutputs: z.array(WorkflowKeyOutputSchema).max(WORKFLOW_KEY_OUTPUTS_LIMIT),
    Delivery: WorkflowKeyOutputDeliverySchema.optional(),
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
  .strict()
  .superRefine((value, ctx) => refineKeyOutputPattern(value.Pattern, ctx));

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

export const EditWorkflowKeyOutputDeliverySchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    Enabled: z.boolean(),
    DestinationUri: z.string().trim().max(1024).optional(),
  })
  .strict()
  .superRefine(refineDeliveryDestination);
export type EditWorkflowKeyOutputDelivery = z.infer<typeof EditWorkflowKeyOutputDeliverySchema>;

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

export const RequestRunWorkflowKeyOutputsSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().min(1),
  })
  .strict();
export type RequestRunWorkflowKeyOutputs = z.infer<typeof RequestRunWorkflowKeyOutputsSchema>;
