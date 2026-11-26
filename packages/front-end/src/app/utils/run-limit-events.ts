import type { RunLimitHit } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import type { RunLimitBlockReason } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import { formatUsd } from '@FE/utils/run-costs';

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "Samples 3 (limit 2)" or "Cost US$12.40 (limit US$10.00)". */
export function formatRunLimitHit(hit: RunLimitHit): string {
  if (hit.limit === 'cost') {
    return `Cost ${formatUsd(hit.runValue)} (limit ${formatUsd(hit.amount)})`;
  }
  return `Samples ${formatCount(hit.runValue)} (limit ${formatCount(hit.amount)})`;
}

const BLOCK_REASON_LABELS: Record<RunLimitBlockReason, string> = {
  limitExceeded: 'Over the limit',
  samplesNotCounted: "Samples couldn't be counted",
  costEstimateFailed: "Cost couldn't be estimated",
};

/** A blocked event with no stored reason was a plain limit block. */
export function blockReasonLabel(reason: RunLimitBlockReason | undefined): string {
  return BLOCK_REASON_LABELS[reason ?? 'limitExceeded'];
}
