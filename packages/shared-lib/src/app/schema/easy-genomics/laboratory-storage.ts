import { z } from 'zod';

export const LaboratoryStorageItemTypeSchema = z.enum(['RunOutputs', 'InputData', 'SampleSheet', 'Unattached']);
export type LaboratoryStorageItemType = z.infer<typeof LaboratoryStorageItemTypeSchema>;

export const LaboratoryStorageItemStatusSchema = z.enum(['Active', 'Running', 'RunFailed', 'Expiring', 'NoRunRecord']);
export type LaboratoryStorageItemStatus = z.infer<typeof LaboratoryStorageItemStatusSchema>;

/** One row of the lab storage inventory: a run's outputs, inputs or sample sheet, or a folder no run claims. */
export const LaboratoryStorageItemSchema = z.object({
  ItemId: z.string(),
  Type: LaboratoryStorageItemTypeSchema,
  Name: z.string(),
  /** Location relative to the laboratory prefix. */
  Path: z.string(),
  /** Workflow name, sample count, or why the item has no run. */
  Detail: z.string(),
  RunId: z.string().optional(),
  FileCount: z.number().int(),
  SizeBytes: z.number(),
  LastModified: z.string().optional(),
  ProtectedFileCount: z.number().int(),
  Status: LaboratoryStorageItemStatusSchema,
  /** False for runs still in progress and for data with no run record younger than 30 days. */
  Deletable: z.boolean(),
});
export type LaboratoryStorageItem = z.infer<typeof LaboratoryStorageItemSchema>;

export const LaboratoryStorageTotalsSchema = z.object({
  OrganizationId: z.string().uuid(),
  LaboratoryId: z.string().uuid(),
  S3Bucket: z.string(),
  ScannedAt: z.string(),
  TotalBytes: z.number(),
  AttachedBytes: z.number(),
  NoRunRecordBytes: z.number(),
  NoRunRecordFileCount: z.number().int(),
  ProtectedItemCount: z.number().int(),
  RunCount: z.number().int(),
  /** S3 Standard first-tier price for the bucket's region; absent when the Pricing API could not answer. */
  PricePerGbMonthUsd: z.number().optional(),
});
export type LaboratoryStorageTotals = z.infer<typeof LaboratoryStorageTotalsSchema>;

export const LaboratoryStorageSummarySchema = LaboratoryStorageTotalsSchema.extend({
  Items: z.array(LaboratoryStorageItemSchema),
});
export type LaboratoryStorageSummary = z.infer<typeof LaboratoryStorageSummarySchema>;

export const OrganizationStorageLabSchema = z.object({
  LaboratoryId: z.string().uuid(),
  Name: z.string(),
  S3Bucket: z.string().optional(),
  RunRetentionMonths: z.number().int().optional(),
  /** Absent until the lab has been scanned once. */
  Storage: LaboratoryStorageTotalsSchema.optional(),
});
export type OrganizationStorageLab = z.infer<typeof OrganizationStorageLabSchema>;

export const RequestOrganizationStorageSchema = z.object({ OrganizationId: z.string().uuid() }).strict();
export type RequestOrganizationStorage = z.infer<typeof RequestOrganizationStorageSchema>;

export const EditLaboratoryStorageProtectionSchema = z
  .object({
    OrganizationId: z.string().uuid(),
    LaboratoryId: z.string().uuid(),
    ItemIds: z.array(z.string().min(1)).min(1).max(100),
    Protected: z.boolean(),
  })
  .strict();
export type EditLaboratoryStorageProtection = z.infer<typeof EditLaboratoryStorageProtectionSchema>;

export const RemoveLaboratoryStorageItemsSchema = z
  .object({
    OrganizationId: z.string().uuid(),
    LaboratoryId: z.string().uuid(),
    ItemIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();
export type RemoveLaboratoryStorageItems = z.infer<typeof RemoveLaboratoryStorageItemsSchema>;

export const RemoveLaboratoryStorageItemsResponseSchema = z.object({
  DeletedObjectCount: z.number().int(),
  SkippedObjectCount: z.number().int(),
  Summary: LaboratoryStorageSummarySchema,
});
export type RemoveLaboratoryStorageItemsResponse = z.infer<typeof RemoveLaboratoryStorageItemsResponseSchema>;
