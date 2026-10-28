import { AllowedS3PrefixSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-s3-access';
import type {
  BatchLaboratoryS3AccessAssignment,
  LaboratoryS3Access,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';

const KEY_SEPARATOR = '::';

/** Identifies one lab–bucket cell on the S3 Lab Access page. */
export function s3AccessKey(laboratoryId: string, bucketName: string): string {
  return `${laboratoryId}${KEY_SEPARATOR}${bucketName}`;
}

function parseS3AccessKey(key: string): { laboratoryId: string; bucketName: string } | null {
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const bucketName = key.slice(separatorIndex + KEY_SEPARATOR.length);
  return bucketName ? { laboratoryId: key.slice(0, separatorIndex), bucketName } : null;
}

export function allowedPrefixesFromAssignments(assignments: LaboratoryS3Access[]): Record<string, string> {
  const prefixes: Record<string, string> = {};
  for (const row of assignments) {
    if (row.Effect !== 'DENY' && row.AllowedPrefix) {
      prefixes[s3AccessKey(row.LaboratoryId, row.BucketName)] = row.AllowedPrefix;
    }
  }
  return prefixes;
}

export function wholeBucketKeysFromAssignments(assignments: LaboratoryS3Access[]): Set<string> {
  const keys = new Set<string>();
  for (const row of assignments) {
    if (row.Effect !== 'DENY' && row.AllowsWholeBucket) {
      keys.add(s3AccessKey(row.LaboratoryId, row.BucketName));
    }
  }
  return keys;
}

export function normalizeAllowedPrefixInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** The first validation message for a typed allowed folder, or null when it is blank or valid. */
export function allowedPrefixError(value: string): string | null {
  const normalized = normalizeAllowedPrefixInput(value);
  if (!normalized) return null;
  const result = AllowedS3PrefixSchema.safeParse(normalized);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid allowed folder');
}

export function changedAllowedPrefixKeys(
  grantedKeys: Set<string>,
  baseline: Record<string, string>,
  pending: Record<string, string>,
): string[] {
  return [...grantedKeys].filter(
    (key) => normalizeAllowedPrefixInput(baseline[key] ?? '') !== normalizeAllowedPrefixInput(pending[key] ?? ''),
  );
}

export type WholeBucketCells = { baseline: Set<string>; pending: Set<string> };

export function changedWholeBucketKeys(
  grantedKeys: Set<string>,
  baseline: Set<string>,
  pending: Set<string>,
): string[] {
  return [...grantedKeys].filter((key) => baseline.has(key) !== pending.has(key));
}

/**
 * The back-end treats each assignment as the cell's full state, so every grant carries the cell's pending prefix,
 * and a granted cell whose prefix alone changed is re-sent as a grant. Revokes never carry one. A ticked cell is sent
 * as whole-bucket access, never with a folder.
 */
export function withAllowedPrefixChanges(
  grantChanges: BatchLaboratoryS3AccessAssignment[],
  grantedKeys: Set<string>,
  baseline: Record<string, string>,
  pending: Record<string, string>,
  wholeBuckets: WholeBucketCells = { baseline: new Set(), pending: new Set() },
): BatchLaboratoryS3AccessAssignment[] {
  const withPrefix = (cell: { laboratoryId: string; bucketName: string }): BatchLaboratoryS3AccessAssignment => {
    const key = s3AccessKey(cell.laboratoryId, cell.bucketName);
    if (wholeBuckets.pending.has(key)) return { ...cell, granted: true, allowsWholeBucket: true };
    const allowedPrefix = normalizeAllowedPrefixInput(pending[key] ?? '');
    return { ...cell, granted: true, ...(allowedPrefix ? { allowedPrefix } : {}) };
  };

  const changedCells = new Set(grantChanges.map((change) => s3AccessKey(change.laboratoryId, change.bucketName)));
  const assignments = grantChanges.map((change) => (change.granted ? withPrefix(change) : change));
  const resentKeys = new Set([
    ...changedAllowedPrefixKeys(grantedKeys, baseline, pending),
    ...changedWholeBucketKeys(grantedKeys, wholeBuckets.baseline, wholeBuckets.pending),
  ]);
  for (const key of resentKeys) {
    const cell = parseS3AccessKey(key);
    if (cell && !changedCells.has(key)) assignments.push(withPrefix(cell));
  }
  return assignments;
}
