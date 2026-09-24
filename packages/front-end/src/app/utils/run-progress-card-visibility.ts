import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

/**
 * Statuses after which a run no longer emits task progress updates. Includes 'ABORTED'
 * because the Seqera Platform reports it in place of 'CANCELLED'.
 */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'FAILED',
  'SUCCEEDED',
  'CANCELLED',
  'COMPLETED',
  'DELETED',
  'ABORTED',
]);

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_RUN_STATUSES.has(status);
}

type RunPlatformAndStatus = Pick<LaboratoryRun, 'Platform' | 'Status'> | null | undefined;

/**
 * Whether the Seqera Task Breakdown card has anything to show. Failure reason and
 * failed tasks render in their own cards, so only a task progress payload keeps
 * this one open; `failureReason` is accepted but ignored for call-site symmetry.
 */
export function showSeqeraTaskProgressCard(
  run: RunPlatformAndStatus,
  content: { failureReason?: string | null; hasProgress?: boolean },
): boolean {
  if (run?.Platform !== 'Seqera Cloud') return false;

  return !!content.hasProgress;
}

/**
 * Whether the HealthOmics Task Progress card has anything to show. Failure reason and
 * failed tasks moved into their own cards, so this one is now purely live progress —
 * which stops once the run reaches a terminal status. `failureReason` and
 * `failedTaskCount` are accepted but ignored, so call sites read the same for both
 * platforms.
 */
export function showOmicsTaskProgressCard(
  run: RunPlatformAndStatus,
  content: { failureReason?: string | null; failedTaskCount?: number; hasProgress?: boolean },
): boolean {
  if (run?.Platform !== 'AWS HealthOmics') return false;

  return !!content.hasProgress && !isTerminalRunStatus(run.Status);
}
