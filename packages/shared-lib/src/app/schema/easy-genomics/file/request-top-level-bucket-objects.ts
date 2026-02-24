import { z } from 'zod';

// request-top-level-bucket-objects API request validation schemas
export const RequestTopLevelBucketObjectsSchema = z
  .object({
    LaboratoryId: z.string(),
    S3Bucket: z.string().optional(),
    S3Prefix: z.string().optional(),
    MaxKeys: z.number().optional(),
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

export const S3TopLevelResponseSchema = z.object({
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
