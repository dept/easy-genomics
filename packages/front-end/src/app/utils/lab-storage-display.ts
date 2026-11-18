import type {
  LaboratoryStorageItem,
  LaboratoryStorageSummary,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';

/** "Never" / "1 month" / "N months" — shared by the retention pill, dropdown, and warning copy. */
export function formatRetentionMonthsLabel(months: number): string {
  if (months === 0) return 'Never';
  return `${months} month${months === 1 ? '' : 's'}`;
}

type ProtectionCounts = { RunId?: string; FileCount: number; ProtectedFileCount: number };

/**
 * Unique runs that have at least one fully protected storage item.
 * Do not use ProtectedItemCount here — one run can contribute outputs + reads + sample sheet.
 */
export function countFullyProtectedRuns(items: ProtectionCounts[]): number {
  const runIds = new Set<string>();
  for (const item of items) {
    if (item.RunId && item.FileCount > 0 && item.ProtectedFileCount >= item.FileCount) {
      runIds.add(item.RunId);
    }
  }
  return runIds.size;
}

function sumBytes(items: Pick<LaboratoryStorageItem, 'SizeBytes'>[]): number {
  return items.reduce((sum, item) => sum + item.SizeBytes, 0);
}

/** Recompute dashboard totals from the current Items list (keeps ScannedAt / price / RunCount). */
export function recomputeLaboratoryStorageTotals(
  summary: LaboratoryStorageSummary,
): LaboratoryStorageSummary {
  const items = summary.Items;
  const unattached = items.filter((item) => item.Type === 'Unattached');
  return {
    ...summary,
    TotalBytes: sumBytes(items),
    AttachedBytes: sumBytes(items.filter((item) => item.Type !== 'Unattached')),
    NoRunRecordBytes: sumBytes(unattached),
    NoRunRecordFileCount: unattached.reduce((sum, item) => sum + item.FileCount, 0),
    ProtectedItemCount: items.filter((item) => item.FileCount > 0 && item.ProtectedFileCount >= item.FileCount)
      .length,
  };
}

/**
 * Optimistic UI after protect/unprotect is queued: S3 tags apply async, but the table/pills
 * should reflect the intended state immediately.
 */
export function applyStorageProtectionOptimistic(
  summary: LaboratoryStorageSummary,
  itemIds: string[],
  isProtected: boolean,
): LaboratoryStorageSummary {
  const idSet = new Set(itemIds);
  const Items = summary.Items.map((item) => {
    if (!idSet.has(item.ItemId)) return item;
    return {
      ...item,
      ProtectedFileCount: isProtected ? item.FileCount : 0,
    };
  });
  return recomputeLaboratoryStorageTotals({ ...summary, Items });
}

/**
 * Optimistic UI after delete is queued: drop the rows from the inventory so the table and
 * size pills update without waiting for the removal worker + rescan.
 */
export function applyStorageRemovalOptimistic(
  summary: LaboratoryStorageSummary,
  itemIds: string[],
): LaboratoryStorageSummary {
  const idSet = new Set(itemIds);
  const Items = summary.Items.filter((item) => !idSet.has(item.ItemId));
  return recomputeLaboratoryStorageTotals({ ...summary, Items });
}
