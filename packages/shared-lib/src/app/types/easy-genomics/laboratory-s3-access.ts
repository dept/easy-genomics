/**
 * Lab–bucket grants stored in laboratory-s3-access-table.
 * Partition key: LaboratoryId; sort key: BucketName.
 *
 * Semantics depend on Laboratory.EnableNewBucketsByDefault:
 * - false/undefined (strict): only ALLOW rows grant access. If the lab has zero
 *   access rows (pre-seed), Laboratory.S3Bucket is treated as allowed.
 * - true: DENY rows block access; no row = implicit allow for catalog (data-tagged) buckets.
 */
export const LABORATORY_S3_ACCESS_EFFECTS = ['ALLOW', 'DENY'] as const;
export type LaboratoryS3AccessEffect = (typeof LABORATORY_S3_ACCESS_EFFECTS)[number];

export interface LaboratoryS3Access {
  LaboratoryId: string;
  BucketName: string;
  OrganizationId: string;
  /** ALLOW or DENY; omitted/undefined on legacy rows means ALLOW. */
  Effect?: LaboratoryS3AccessEffect;
  /**
   * ALLOW rows only: an absolute prefix (ends in "/") outside `{OrganizationId}/{LaboratoryId}/` that Data Collections
   * may also list and import from in this bucket. Removed whenever the row is revoked or rewritten without it.
   */
  AllowedPrefix?: string;
  CreatedAt?: string;
  ModifiedAt?: string;
}

/** API / UI catalog row (data-tagged S3 buckets). */
export interface S3BucketCatalogEntry {
  name: string;
}

export interface ListLaboratoryS3AccessAssignmentsResponse {
  assignments: LaboratoryS3Access[];
}

export interface ListS3BucketCatalogResponse {
  buckets: S3BucketCatalogEntry[];
}

export interface ListGrantedLaboratoryBucketsResponse {
  buckets: string[];
  /** Granted bucket name → its allowed prefix. Buckets without one are absent; a missing map means no bucket has one. */
  allowedPrefixes?: Record<string, string>;
}

export interface BatchLaboratoryS3AccessAssignment {
  laboratoryId: string;
  bucketName: string;
  granted: boolean;
  /**
   * With `granted: true` only. Each assignment is the cell's full state: a grant without it clears any stored
   * prefix, and a revoke always drops it.
   */
  allowedPrefix?: string;
}

export interface BatchUpdateLaboratoryS3AccessRequest {
  assignments: BatchLaboratoryS3AccessAssignment[];
}

/** A lab whose default S3 bucket was cleared because access to it was revoked. */
export interface ClearedLaboratoryDefaultBucket {
  laboratoryId: string;
  bucketName: string;
}

export interface BatchUpdateLaboratoryS3AccessResponse {
  ok: boolean;
  /** Labs whose default S3 bucket was cleared as a side effect of a revoke. */
  clearedDefaults: ClearedLaboratoryDefaultBucket[];
}
