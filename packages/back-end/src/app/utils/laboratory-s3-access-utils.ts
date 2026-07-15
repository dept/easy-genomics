import { S3BucketAccessDeniedError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type {
  LaboratoryS3Access,
  S3BucketCatalogEntry,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';

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

export function isS3BucketAccessAllowed(
  laboratory: Pick<Laboratory, 'EnableNewBucketsByDefault'>,
  accessRows: LaboratoryS3Access[],
  bucketName: string,
): boolean {
  const defaultOn = laboratory.EnableNewBucketsByDefault === true;
  if (!defaultOn) {
    return allowBucketNames(accessRows).has(bucketName);
  }
  return !denyBucketNames(accessRows).has(bucketName);
}

export function grantedBucketNamesForLaboratory(
  laboratory: Pick<Laboratory, 'EnableNewBucketsByDefault'>,
  accessRows: LaboratoryS3Access[],
  catalog: S3BucketCatalogEntry[],
): string[] {
  const defaultOn = laboratory.EnableNewBucketsByDefault === true;
  if (!defaultOn) {
    return [...allowBucketNames(accessRows)].sort();
  }
  const denied = denyBucketNames(accessRows);
  return catalog
    .map((b) => b.name)
    .filter((name) => !denied.has(name))
    .sort();
}

export async function assertLaboratoryHasS3BucketAccess(
  laboratory: Pick<Laboratory, 'LaboratoryId' | 'EnableNewBucketsByDefault'>,
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
  }

  const rows = await accessService.listByLaboratoryId(laboratory.LaboratoryId);
  if (!isS3BucketAccessAllowed(laboratory, rows, bucketName)) {
    throw new S3BucketAccessDeniedError();
  }
}
