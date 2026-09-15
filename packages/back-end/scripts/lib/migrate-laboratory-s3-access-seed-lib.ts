/**
 * Pure helpers for the one-time laboratory S3 access seed migration.
 */

/**
 * Whether the migration should upsert an ALLOW row for the lab's configured S3Bucket.
 * Matches the original script: skip when no bucket, or when an non-DENY assignment already exists.
 * An existing DENY on the configured bucket is overwritten with ALLOW (restore default access).
 */
export function shouldSeedAllowForLaboratory(params: {
  configuredBucket: string | undefined | null;
  existing: { Effect?: string } | undefined | null;
}): boolean {
  const bucket = params.configuredBucket?.trim();
  if (!bucket) {
    return false;
  }
  if (params.existing && params.existing.Effect !== 'DENY') {
    return false;
  }
  return true;
}
