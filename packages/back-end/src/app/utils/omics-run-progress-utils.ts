import { TaskListItem, TaskStatus } from '@aws-sdk/client-omics';

export type OmicsTaskProgress = {
  tasksTotal: number;
  tasksCompleted: number;
  tasksRunning: number;
  tasksFailed: number;
  percent: number;
};

const RUNNING_STATUSES: ReadonlySet<string> = new Set<TaskStatus>(['RUNNING', 'STARTING']);

/**
 * Derive an approximate progress snapshot from HealthOmics ListRunTasks items.
 * Percent is completed/total-known; the denominator grows as the Nextflow DAG expands,
 * so callers should surface raw counts alongside the percentage.
 */
export function aggregateTaskProgress(items: TaskListItem[]): OmicsTaskProgress {
  const tasksTotal = items.length;
  let tasksCompleted = 0;
  let tasksRunning = 0;
  let tasksFailed = 0;

  for (const item of items) {
    const status = item.status;
    if (status === 'COMPLETED') {
      tasksCompleted += 1;
    } else if (status === 'FAILED') {
      tasksFailed += 1;
    } else if (status != null && RUNNING_STATUSES.has(status)) {
      tasksRunning += 1;
    }
  }

  const percent = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

  return {
    tasksTotal,
    tasksCompleted,
    tasksRunning,
    tasksFailed,
    percent,
  };
}
