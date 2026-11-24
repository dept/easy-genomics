import { z } from 'zod';

/** The Run costs report covers either one calendar month or the rolling 30, 60 or 90 days to today (UTC). */
export const RunCostsQuerySchema = z.discriminatedUnion('period', [
  z
    .object({
      organizationId: z.string().uuid(),
      period: z.literal('month'),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    })
    .strict(),
  z
    .object({
      organizationId: z.string().uuid(),
      period: z.enum(['30d', '60d', '90d']),
    })
    .strict(),
]);
export type RunCostsQuery = z.infer<typeof RunCostsQuerySchema>;
