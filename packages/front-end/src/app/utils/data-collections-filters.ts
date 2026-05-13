import type { LaboratoryRunUsageSummary } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';

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
