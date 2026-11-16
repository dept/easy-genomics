import { z } from 'zod';

export const RunLimitEventKindSchema = z.enum(['warned', 'blocked']);

/** The Run costs periods, plus which kind of event to list. */
export const RunLimitEventsQuerySchema = z.discriminatedUnion('period', [
  z
    .object({
      organizationId: z.string().uuid(),
      period: z.literal('month'),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      kind: RunLimitEventKindSchema,
    })
    .strict(),
  z
    .object({
      organizationId: z.string().uuid(),
      period: z.enum(['30d', '60d', '90d']),
      kind: RunLimitEventKindSchema,
    })
    .strict(),
]);
export type RunLimitEventsQuery = z.infer<typeof RunLimitEventsQuerySchema>;
