import { z } from 'zod';

export const RequestLaboratoryBucketObjectsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    /** Optional prefix relative to the lab root `${OrganizationId}/${LaboratoryId}/`. */
    RelativePrefix: z.string().optional(),
    /**
     * When true, lists all object keys under the resolved prefix (no delimiter), paginated until
     * {@link MaxTotalKeys} is reached or S3 has no more results.
     */
    Recursive: z.boolean().optional(),
    /**
     * Hard cap on how many file objects to return when {@link Recursive} is true (prevents huge payloads).
     * Default 15_000; max 50_000.
     */
    MaxTotalKeys: z.number().int().min(1).max(50000).optional(),
    /** Max keys per S3 ListObjectsV2 request page (1–1000). Applies to both modes. */
    MaxKeys: z.number().int().positive().max(1000).optional(),
  })
  .strict();
