import { z } from 'zod';

/**
 * Pre-run input features persisted at create-laboratory-run for historical
 * similarity matching in the cost estimator.
 */
export const RunInputProfileSchema = z
  .object({
    SampleCount: z.number().nonnegative(),
    InputFileCount: z.number().nonnegative(),
    InputBytesTotal: z.number().nonnegative(),
    ParameterHash: z.string(),
    InputBytesByExtension: z.record(z.string(), z.number()).optional(),
  })
  .strict();
export type RunInputProfile = z.infer<typeof RunInputProfileSchema>;

/**
 * Snapshot of the pre-run estimate shown on Review & Launch (and recomputed
 * server-side at create time for consistency).
 */
export const PreRunCostEstimateSchema = z
  .object({
    LowUsd: z.number().nonnegative(),
    HighUsd: z.number().nonnegative(),
    MedianUsd: z.number().nonnegative(),
    Confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
    ComparableRunCount: z.number().int().nonnegative(),
    EstimatedAt: z.string(),
    Exclusions: z.array(z.string()),
  })
  .strict();
export type PreRunCostEstimate = z.infer<typeof PreRunCostEstimateSchema>;

/**
 * Platform compute (and optional HealthOmics storage) estimate captured at
 * terminal state from ListRunTasks / Tower progress.
 */
export const RunCostOutcomeSchema = z
  .object({
    ActualComputeCostUsd: z.number().nonnegative().optional(),
    ActualStorageCostUsd: z.number().nonnegative().optional(),
    CostSource: z.enum(['HEALTHOMICS_TASKS', 'SEQERA_PROGRESS']),
    CostCapturedAt: z.string(),
  })
  .strict();
export type RunCostOutcome = z.infer<typeof RunCostOutcomeSchema>;

/**
 * AWS Cost Explorer billed cost synced ~24–48h after run completion.
 */
export const BilledCostSchema = z
  .object({
    TotalUsd: z.number().nonnegative(),
    AsOfDate: z.string(),
    SyncedAt: z.string(),
    ByService: z.record(z.string(), z.number()).optional(),
  })
  .strict();
export type BilledCost = z.infer<typeof BilledCostSchema>;

export const EstimateRunCostRequestSchema = z
  .object({
    platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    workflowExternalId: z.string().min(1),
    workflowVersionName: z.string().optional(),
    inputFileKeys: z.array(z.string()).optional(),
    sampleSheetS3Url: z.string().optional(),
    settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
    sampleCount: z.number().nonnegative().optional(),
    inputBytesTotal: z.number().nonnegative().optional(),
  })
  .strict();
export type EstimateRunCostRequest = z.infer<typeof EstimateRunCostRequestSchema>;

export const EstimateRunCostResponseSchema = z
  .object({
    estimateAvailable: z.boolean(),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
    comparableRunCount: z.number().int().nonnegative(),
    computeCostUsd: z
      .object({
        low: z.number().nonnegative(),
        median: z.number().nonnegative(),
        high: z.number().nonnegative(),
      })
      .optional(),
    currency: z.literal('USD'),
    label: z.string(),
    disclaimer: z.string(),
    exclusions: z.array(z.string()),
  })
  .strict();
export type EstimateRunCostResponse = z.infer<typeof EstimateRunCostResponseSchema>;
