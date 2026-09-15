import { ProgressData, WorkflowLoad } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';

/**
 * Same shape as OmicsTaskProgress so status-check persistence can stay platform-agnostic.
 */
export type SeqeraTaskProgress = {
  tasksTotal: number;
  tasksCompleted: number;
  tasksRunning: number;
  tasksFailed: number;
  percent: number;
};

function asNonNegInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Map Seqera GET /workflow/{id}/progress payload into a LaboratoryRun progress snapshot.
 */
export function aggregateSeqeraProgress(progress: ProgressData | undefined | null): SeqeraTaskProgress | undefined {
  if (!progress?.workflowProgress) return undefined;

  const wp: WorkflowLoad = progress.workflowProgress;
  const pending = asNonNegInt(wp.pending);
  const submitted = asNonNegInt(wp.submitted);
  const running = asNonNegInt(wp.running);
  const succeeded = asNonNegInt(wp.succeeded);
  const failed = asNonNegInt(wp.failed);
  const cached = asNonNegInt(wp.cached);

  const tasksCompleted = succeeded + cached;
  const tasksRunning = running;
  const tasksFailed = failed;
  const tasksTotal = pending + submitted + running + succeeded + failed + cached;
  const percent = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

  return {
    tasksTotal,
    tasksCompleted,
    tasksRunning,
    tasksFailed,
    percent,
  };
}
