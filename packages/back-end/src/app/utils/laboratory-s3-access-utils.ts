import { S3BucketAccessDeniedError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type {
  LaboratoryS3Access,
  S3BucketCatalogEntry,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { isDataTaggedS3Bucket } from '@BE/services/easy-genomics/s3-bucket-catalog-service';

/** Legacy rows and explicit ALLOW. */
export function rowIsAllow(row: LaboratoryS3Access): boolean {
  return row.Effect !== 'DENY';
}

export function rowIsDeny(row: LaboratoryS3Access): boolean {
  return row.Effect === 'DENY';
}

export function allowBucketNames(accessList: LaboratoryS3Access[]): Set<string> {
  const names = new Set<string>();
  for (const row of accessList) {
    if (rowIsAllow(row)) {
      names.add(row.BucketName);
    }
  }
  return names;
}

export function denyBucketNames(accessList: LaboratoryS3Access[]): Set<string> {
  const names = new Set<string>();
  for (const row of accessList) {
    if (rowIsDeny(row)) {
      names.add(row.BucketName);
    }
  }
  return names;
}

/**
 * Whether a lab may use `bucketName` given its access rows.
 *
 * Strict mode (`EnableNewBucketsByDefault !== true`): ALLOW rows grant access.
 * If the lab has zero access rows (pre-seed migration), the configured
 * `Laboratory.S3Bucket` is treated as allowed so existing labs are not locked out.
 *
 * Default-on: anything not on an explicit DENY row is allowed (catalog membership
 * is enforced separately by `assertLaboratoryHasS3BucketAccess`).
 */
export function isS3BucketAccessAllowed(
  laboratory: Pick<Laboratory, 'EnableNewBucketsByDefault' | 'S3Bucket'>,
  accessRows: LaboratoryS3Access[],
  bucketName: string,
): boolean {
  const defaultOn = laboratory.EnableNewBucketsByDefault === true;
  if (!defaultOn) {
    if (allowBucketNames(accessRows).has(bucketName)) {
      return true;
    }
    // Unmigrated labs: no access rows yet → allow the configured default bucket only.
    if (accessRows.length === 0) {
      const configured = laboratory.S3Bucket?.trim();
      return !!configured && configured === bucketName;
    }
    return false;
  }
  return !denyBucketNames(accessRows).has(bucketName);
}

export function grantedBucketNamesForLaboratory(
  laboratory: Pick<Laboratory, 'EnableNewBucketsByDefault' | 'S3Bucket'>,
  accessRows: LaboratoryS3Access[],
  catalog: S3BucketCatalogEntry[],
): string[] {
  const catalogNames = new Set(catalog.map((entry) => entry.name));
  const defaultOn = laboratory.EnableNewBucketsByDefault === true;
  if (!defaultOn) {
    const allowed = allowBucketNames(accessRows);
    return [...allowed].filter((name) => catalogNames.has(name)).sort();
  }
  const denied = denyBucketNames(accessRows);
  return catalog
    .map((b) => b.name)
    .filter((name) => !denied.has(name))
    .sort();
}

/**
 * Deny unless `bucketName` is a data-tagged catalog bucket and the lab is allowed
 * to use it. When `catalog` is omitted, membership is checked via a single-bucket
 * tag lookup (cheaper than listing the full catalog on every request).
 */
export async function assertLaboratoryHasS3BucketAccess(
  laboratory: Pick<Laboratory, 'LaboratoryId' | 'EnableNewBucketsByDefault' | 'S3Bucket'>,
  bucketName: string,
  accessService: LaboratoryS3AccessService,
  catalog?: S3BucketCatalogEntry[],
): Promise<void> {
  if (!bucketName) {
    throw new S3BucketAccessDeniedError();
  }

  if (catalog) {
    const catalogNames = new Set(catalog.map((b) => b.name));
    if (!catalogNames.has(bucketName)) {
      throw new S3BucketAccessDeniedError();
    }
  } else {
    const inCatalog = await isDataTaggedS3Bucket(bucketName);
    if (!inCatalog) {
      throw new S3BucketAccessDeniedError();
    }
  }

  const rows = await accessService.listByLaboratoryId(laboratory.LaboratoryId);
  if (!isS3BucketAccessAllowed(laboratory, rows, bucketName)) {
    throw new S3BucketAccessDeniedError();
  }
}
