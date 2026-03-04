import { z } from 'zod';

// request-search-bucket-objects API request validation schemas
export const RequestSearchBucketObjectsSchema = z
  .object({
    LaboratoryId: z.string(),
    SearchQuery: z.string().min(1),
    S3Bucket: z.string().optional(),
    S3Prefix: z.string().optional(),
    MaxResults: z.number().int().positive().max(1000).optional(),
  })
  .strict();

export const S3ObjectSchema = z.object({
  Key: z.string(),
  LastModified: z.string(),
  ETag: z.string(),
  Size: z.number(),
  StorageClass: z.string(),
});

export const S3PrefixSchema = z.object({
  Prefix: z.string(),
});

export const S3SearchResponseSchema = z.object({
  $metadata: z.object({
    httpStatusCode: z.number(),
    requestId: z.string(),
    extendedRequestId: z.string(),
    attempts: z.number(),
    totalRetryDelay: z.number(),
  }),
  Contents: z.array(S3ObjectSchema).optional(),
  CommonPrefixes: z.array(S3PrefixSchema).optional(),
  IsTruncated: z.boolean(),
});
