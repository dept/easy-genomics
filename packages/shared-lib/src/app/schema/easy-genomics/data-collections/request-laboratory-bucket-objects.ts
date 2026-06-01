import { z } from 'zod';

export const RequestLaboratoryBucketObjectsSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    /** Optional prefix relative to the lab root `${OrganizationId}/${LaboratoryId}/`. */
    RelativePrefix: z.string().optional(),
    /**
     * Hard cap on how many file objects to return (prevents huge payloads).
     * Default 15_000; max 50_000.
     */
    MaxTotalKeys: z.number().int().min(1).max(50000).optional(),
    /**
     * Max transaction folders to walk before stopping with {@link ListingTruncated}.
     * Default 10_000; max 50_000.
     */
    MaxTransactionFolders: z.number().int().min(1).max(50000).optional(),
    /** Max keys per S3 ListObjectsV2 request page (1–1000). */
    MaxKeys: z.number().int().positive().max(1000).optional(),
  })
  .strict();
