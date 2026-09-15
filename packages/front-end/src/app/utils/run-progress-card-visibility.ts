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
 * Whether the Seqera Task Breakdown card has anything to show: either a failure reason
 * or a task progress payload.
 */
export function showSeqeraTaskProgressCard(
  run: RunPlatformAndStatus,
  content: { failureReason?: string | null; hasProgress?: boolean },
): boolean {
  if (run?.Platform !== 'Seqera Cloud') return false;

  return !!content.failureReason || !!content.hasProgress;
}

/**
 * Whether the HealthOmics Task Progress / Failed Tasks card has anything to show. Live
 * progress is only rendered while the run is non-terminal, so it alone does not keep the
 * card open once the run finishes — failure content does.
 */
export function showOmicsTaskProgressCard(
  run: RunPlatformAndStatus,
  content: { failureReason?: string | null; failedTaskCount?: number; hasProgress?: boolean },
): boolean {
  if (run?.Platform !== 'AWS HealthOmics') return false;

  const { failureReason, failedTaskCount = 0, hasProgress = false } = content;

  return !!failureReason || failedTaskCount > 0 || (hasProgress && !isTerminalRunStatus(run.Status));
}
