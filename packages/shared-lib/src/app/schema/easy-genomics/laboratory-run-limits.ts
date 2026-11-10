import { z } from 'zod';

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
        message: 'Block above must be higher than warn above for estimated cost per run.',
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
