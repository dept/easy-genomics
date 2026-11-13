import type {
  LaboratoryDataTag,
  LaboratoryRunUsageSummary,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import type { LaboratorySample } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';

/**
 * Pure helpers backing the Data Collections page scope filters. Extracted from the Vue SFC so
 * they can be unit-tested without booting a Vue test runner. The Vue component imports these
 * directly and provides its own reactive state.
 *
 * Conventions:
 *   - All `expiresAt` values are epoch seconds (matching the DynamoDB TTL attribute on the
 *     `laboratory-run-table`).
 *   - "Permanent" is determined by `keyToIsPermanent[key]`; the shape mirrors the map populated
 *     from `listFileTags` (`FileTagAssignment.IsPermanent`).
 *   - `nowEpoch` is parameterised so tests get deterministic behaviour.
 */

/** Retention column: permanent files never expire; otherwise the soonest run expiry, or an em dash. */
export function formatRetentionExpiryLabel(
  isPermanent: boolean,
  usages: LaboratoryRunUsageSummary[] | undefined,
  nowEpoch: number = Math.floor(Date.now() / 1000),
): string {
  if (isPermanent) return 'Never';
  const epoch = soonestExpiresAtForUsages(usages);
  if (epoch === undefined) return '—';
  const diffDays = Math.round((epoch - nowEpoch) / 86400);
  if (diffDays <= 0) return 'Expired';
  if (diffDays === 1) return 'in 1 day';
  if (diffDays < 30) return `in ${diffDays} days`;
  const months = Math.round(diffDays / 30);
  return months <= 1 ? 'in ~1 month' : `in ~${months} months`;
}

export function soonestExpiresAtForUsages(usages: LaboratoryRunUsageSummary[] | undefined): number | undefined {
  if (!usages || !usages.length) return undefined;
  let soonest: number | undefined;
  for (const u of usages) {
    if (typeof u.ExpiresAt === 'number') {
      if (soonest === undefined || u.ExpiresAt < soonest) soonest = u.ExpiresAt;
    }
  }
  return soonest;
}

/**
 * A file is "expiring soon" iff:
 *   1. it is NOT marked permanent (permanent files are protected from auto-deletion);
 *   2. it has at least one recorded run usage with a defined `ExpiresAt`;
 *   3. that soonest `ExpiresAt` falls within `thresholdDays` of `nowEpoch`.
 *
 * Files whose run usages all lack `ExpiresAt` (non-expiring lab, or run not yet terminal) are
 * intentionally excluded — they have no schedule to compare against.
 */
export function isExpiringSoon(opts: {
  isPermanent: boolean;
  usages: LaboratoryRunUsageSummary[] | undefined;
  thresholdDays: number;
  nowEpoch: number;
}): boolean {
  if (opts.isPermanent) return false;
  const soonest = soonestExpiresAtForUsages(opts.usages);
  if (soonest === undefined) return false;
  const horizonSeconds = opts.thresholdDays * 86400;
  return soonest - opts.nowEpoch <= horizonSeconds;
}

/**
 * Samples side list: user tags, plus Permanent once the current sample list has one.
 * Permanent is system-managed, so it is not created from the "New Tag" field.
 */
export function sidebarTagsForSamples(tags: LaboratoryDataTag[], samples: LaboratorySample[]): LaboratoryDataTag[] {
  const standard = tags.filter((t) => (t.Kind ?? 'standard') === 'standard');
  const permanent = tags.find((t) => t.Kind === 'permanent');
  if (!permanent || !samples.some((s) => s.IsPermanent)) return standard;
  return [...standard, permanent];
}

/** Tag filter is OR. Permanent matches `IsPermanent` because that id is not stored in the sample's standard tag ids. */
export function sampleMatchesTagIds(
  sample: LaboratorySample,
  sampleStandardTagIds: string[],
  selectedTagIds: readonly string[],
  permanentTagId?: string,
): boolean {
  const selected = new Set(selectedTagIds);
  if (permanentTagId && selected.has(permanentTagId) && sample.IsPermanent) return true;
  return sampleStandardTagIds.some((id) => selected.has(id));
}

/** Samples tab search: sample name substring match, or all samples in a batch whose name matches. */
export function filterSamplesBySearch(
  samples: LaboratorySample[],
  tags: LaboratoryDataTag[],
  query: string,
): LaboratorySample[] {
  const q = query.trim().toLowerCase();
  if (!q) return samples;

  const matchingBatchIds = new Set(
    tags.filter((t) => t.Kind === 'batch' && t.Name.toLowerCase().includes(q)).map((t) => t.TagId),
  );

  return samples.filter(
    (s) => s.Name.toLowerCase().includes(q) || (s.BatchTagId != null && matchingBatchIds.has(s.BatchTagId)),
  );
}
