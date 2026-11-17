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
