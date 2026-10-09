import { z } from 'zod';

export const RUN_EXPORT_MAX_RUNS = 25;

export const RunExportDestinationSchema = z.enum(['Download', 'S3', 'Lims']);
export type RunExportDestination = z.infer<typeof RunExportDestinationSchema>;

export const RunExportJobStatusSchema = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type RunExportJobStatus = z.infer<typeof RunExportJobStatusSchema>;

const RunIdsSchema = z.array(z.string().min(1)).min(1).max(RUN_EXPORT_MAX_RUNS);

export const RequestRunExportPreviewSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    RunIds: RunIdsSchema,
  })
  .strict();
export type RequestRunExportPreview = z.infer<typeof RequestRunExportPreviewSchema>;

export const RunExportPreviewRunSchema = z
  .object({
    RunId: z.string(),
    RunName: z.string().optional(),
    SourceS3Uri: z.string(),
    FileCount: z.number().int().nonnegative(),
    TotalBytes: z.number().nonnegative(),
  })
  .strict();
export type RunExportPreviewRun = z.infer<typeof RunExportPreviewRunSchema>;

export const RunExportPreviewResponseSchema = z
  .object({
    RunCount: z.number().int().nonnegative(),
    FileCount: z.number().int().nonnegative(),
    TotalBytes: z.number().nonnegative(),
    CanDownloadAsZip: z.boolean(),
    ZipSizeLimitBytes: z.number().nonnegative(),
    Runs: z.array(RunExportPreviewRunSchema),
  })
  .strict();
export type RunExportPreviewResponse = z.infer<typeof RunExportPreviewResponseSchema>;

export const RequestRunExportJobSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    RunIds: RunIdsSchema,
    Destination: RunExportDestinationSchema,
    DestinationBucket: z.string().min(1).optional(),
    DestinationPrefix: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.Destination !== 'Download' && !value.DestinationBucket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DestinationBucket'],
        message: 'DestinationBucket is required for S3 and LIMS export',
      });
    }
  });
export type RequestRunExportJob = z.infer<typeof RequestRunExportJobSchema>;

export const RunExportJobResponseSchema = z
  .object({
    JobId: z.string().uuid(),
    Status: RunExportJobStatusSchema,
    Destination: RunExportDestinationSchema,
  })
  .strict();
export type RunExportJobResponse = z.infer<typeof RunExportJobResponseSchema>;

export const RequestRunExportJobStatusSchema = z
  .object({
    LaboratoryId: z.string().min(1),
    JobId: z.string().uuid(),
  })
  .strict();
export type RequestRunExportJobStatus = z.infer<typeof RequestRunExportJobStatusSchema>;

export const RunExportJobStatusResponseSchema = z
  .object({
    JobId: z.string().uuid(),
    Status: RunExportJobStatusSchema,
    Destination: RunExportDestinationSchema.optional(),
    DownloadUrl: z.string().optional(),
    DestinationS3Uri: z.string().optional(),
    FilesCopied: z.number().int().nonnegative().optional(),
    ErrorMessage: z.string().optional(),
  })
  .strict();
export type RunExportJobStatusResponse = z.infer<typeof RunExportJobStatusResponseSchema>;
