import { z } from 'zod';
import { LABORATORY_WORKFLOW_ACCESS_PLATFORMS } from '../../types/easy-genomics/laboratory-workflow-access';

const COST_ORDER_MESSAGE = 'Block above must be higher than warn above for estimated cost per run.';

/**
 * Per-run limits an organization admin sets on a laboratory. A missing amount means that check is off.
 * A block amount must be higher than its warn amount when both are set.
 */
export const LaboratoryRunLimitsSchema = z
  .object({
    CostWarnAboveUsd: z.number().positive().optional(),
    CostBlockAboveUsd: z.number().positive().optional(),
    SamplesWarnAbove: z.number().int().positive().optional(),
    SamplesBlockAbove: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((limits, ctx) => {
    if (
      limits.CostWarnAboveUsd !== undefined &&
      limits.CostBlockAboveUsd !== undefined &&
      limits.CostBlockAboveUsd <= limits.CostWarnAboveUsd
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: COST_ORDER_MESSAGE,
        path: ['CostBlockAboveUsd'],
      });
    }
    if (
      limits.SamplesWarnAbove !== undefined &&
      limits.SamplesBlockAbove !== undefined &&
      limits.SamplesBlockAbove <= limits.SamplesWarnAbove
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Block above must be higher than warn above for samples per run.',
        path: ['SamplesBlockAbove'],
      });
    }
  });

/** The request body is the whole limits object: an omitted field is cleared, and `{}` clears every limit. */
export const UpdateLaboratoryRunLimitsSchema = LaboratoryRunLimitsSchema;
export type UpdateLaboratoryRunLimits = z.infer<typeof UpdateLaboratoryRunLimitsSchema>;

function refineCostOrder(
  limits: { CostWarnAboveUsd?: number; CostBlockAboveUsd?: number },
  ctx: z.RefinementCtx,
): void {
  if (
    limits.CostWarnAboveUsd !== undefined &&
    limits.CostBlockAboveUsd !== undefined &&
    limits.CostBlockAboveUsd <= limits.CostWarnAboveUsd
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: COST_ORDER_MESSAGE, path: ['CostBlockAboveUsd'] });
  }
}

const WorkflowNameSchema = z.string().min(1).max(256);

/**
 * One workflow's own cost amounts within a lab. A missing amount falls back to the lab's for that field,
 * so the order of the amounts that apply is checked against the lab's by costLimitsOrderError.
 */
export const WorkflowCostLimitsSchema = z
  .object({
    WorkflowName: WorkflowNameSchema,
    CostWarnAboveUsd: z.number().positive().optional(),
    CostBlockAboveUsd: z.number().positive().optional(),
  })
  .strict()
  .superRefine(refineCostOrder);

/** Keyed `${Platform}#${WorkflowId}`, with no version: a workflow's limits apply to all its versions. */
export const WorkflowRunLimitsSchema = z.record(z.string(), WorkflowCostLimitsSchema);

/** An omitted amount is cleared; omitting both removes the workflow's entry. */
export const UpdateLaboratoryWorkflowRunLimitsSchema = z
  .object({
    Platform: z.enum(LABORATORY_WORKFLOW_ACCESS_PLATFORMS),
    // No '#', so the id can't change the shape of the `${Platform}#${WorkflowId}` key.
    WorkflowId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    WorkflowName: WorkflowNameSchema,
    CostWarnAboveUsd: z.number().positive().optional(),
    CostBlockAboveUsd: z.number().positive().optional(),
  })
  .strict()
  .superRefine(refineCostOrder);
export type UpdateLaboratoryWorkflowRunLimits = z.infer<typeof UpdateLaboratoryWorkflowRunLimitsSchema>;

export const RunLimitHitSchema = z
  .object({
    limit: z.enum(['cost', 'samples']),
    level: z.enum(['warn', 'block']),
    amount: z.number(),
    runValue: z.number(),
  })
  .strict();
export type RunLimitHit = z.infer<typeof RunLimitHitSchema>;

export const RunLimitVerdictSchema = z
  .object({
    outcome: z.enum(['pass', 'warn', 'block']),
    hits: z.array(RunLimitHitSchema),
    /** `notChecked` means the lab has no cost amount, so the estimate was not computed. */
    costEstimate: z.enum(['available', 'notEnoughHistory', 'notChecked']),
    /** The server-counted samples. Absent only when a lab with cost amounts alone launched without a sample sheet. */
    sampleCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RunLimitVerdict = z.infer<typeof RunLimitVerdictSchema>;
