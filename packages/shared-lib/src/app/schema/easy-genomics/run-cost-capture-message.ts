import { z } from 'zod';

/** Asks the run-cost capture consumer to record a finished run's platform cost. */
export const RunCostCaptureMessageSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    RunId: z.string().min(1),
  })
  .strict();

export type RunCostCaptureMessage = z.infer<typeof RunCostCaptureMessageSchema>;
