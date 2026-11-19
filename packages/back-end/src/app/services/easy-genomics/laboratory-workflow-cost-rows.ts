import { MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE } from '@easy-genomics/shared-lib/src/app/constants/run-cost';
import {
  LaboratoryWorkflowCostRow,
  WorkflowCostLimits,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryWorkflowAccessPlatform } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { parseWorkflowAccessSortKey } from '@easy-genomics/shared-lib/src/app/utils/laboratory-workflow-access-key';
import { percentileToCents } from '@easy-genomics/shared-lib/src/app/utils/run-cost-estimation';
import {
  workflowAccessPlatformForRun,
  workflowRunLimitsKey,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';

// Same success rule as the run cost estimator, so the typical cost and the estimate agree on which runs count.
const SUCCESS_STATUSES = new Set(['COMPLETED', 'SUCCEEDED']);
const TYPICAL_COST_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

type WorkflowRunGroup = {
  platform: LaboratoryWorkflowAccessPlatform;
  workflowId: string;
  latestRun: LaboratoryRun;
  countedCosts: number[];
};

function countedCost(run: LaboratoryRun, windowStartMs: number): number | undefined {
  if (!SUCCESS_STATUSES.has((run.Status || '').toUpperCase())) return undefined;
  const cost = run.RunCostOutcome?.ActualComputeCostUsd;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return undefined;
  const terminalAtMs = run.TerminalAt ? Date.parse(run.TerminalAt) : NaN;
  if (!(terminalAtMs >= windowStartMs)) return undefined;
  return cost;
}

function medianCostToCents(costsUsd: number[]): number {
  return percentileToCents([...costsUsd].sort((a, b) => a - b), 50);
}

function groupRunsByWorkflow(runs: LaboratoryRun[], now: Date): Map<string, WorkflowRunGroup> {
  const windowStartMs = now.getTime() - TYPICAL_COST_WINDOW_DAYS * DAY_MS;
  const groups = new Map<string, WorkflowRunGroup>();

  for (const run of runs) {
    const platform = workflowAccessPlatformForRun(run.Platform);
    if (!platform || !run.WorkflowExternalId) continue;

    const key = workflowRunLimitsKey(platform, run.WorkflowExternalId);
    let group = groups.get(key);
    if (!group) {
      group = { platform, workflowId: run.WorkflowExternalId, latestRun: run, countedCosts: [] };
      groups.set(key, group);
    } else if ((run.CreatedAt || '') > (group.latestRun.CreatedAt || '')) {
      group.latestRun = run;
    }

    const cost = countedCost(run, windowStartMs);
    if (cost !== undefined) group.countedCosts.push(cost);
  }

  return groups;
}

/**
 * One row per workflow a cost limit can act on or already has: every workflow the lab has run records for,
 * plus every workflow with its own limits. The typical cost is the median actual compute cost of recent
 * successful runs, and is left out below MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE so a thin history never
 * reads as a real figure.
 */
export function buildLaboratoryWorkflowCostRows(
  runs: LaboratoryRun[],
  workflowRunLimits: Record<string, WorkflowCostLimits> | undefined,
  now: Date,
): LaboratoryWorkflowCostRow[] {
  const groups = groupRunsByWorkflow(runs, now);
  const limitsByKey = workflowRunLimits ?? {};
  const rows: LaboratoryWorkflowCostRow[] = [];

  for (const [key, group] of groups) {
    const limits: WorkflowCostLimits | undefined = limitsByKey[key];
    const counted = group.countedCosts.length;
    rows.push({
      Platform: group.platform,
      WorkflowId: group.workflowId,
      WorkflowName: group.latestRun.WorkflowName || limits?.WorkflowName || group.workflowId,
      ...(group.latestRun.WorkflowVersionName ? { LatestVersionName: group.latestRun.WorkflowVersionName } : {}),
      ...(limits?.CostWarnAboveUsd !== undefined ? { CostWarnAboveUsd: limits.CostWarnAboveUsd } : {}),
      ...(limits?.CostBlockAboveUsd !== undefined ? { CostBlockAboveUsd: limits.CostBlockAboveUsd } : {}),
      ...(counted >= MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE
        ? { TypicalRunCostUsd: medianCostToCents(group.countedCosts) }
        : {}),
      CountedRunCount: counted,
    });
  }

  for (const [key, limits] of Object.entries(limitsByKey)) {
    if (groups.has(key)) continue;
    const parsed = parseWorkflowAccessSortKey(key);
    if (!parsed) continue;
    rows.push({
      Platform: parsed.platform,
      WorkflowId: parsed.workflowId,
      WorkflowName: limits.WorkflowName || parsed.workflowId,
      ...(limits.CostWarnAboveUsd !== undefined ? { CostWarnAboveUsd: limits.CostWarnAboveUsd } : {}),
      ...(limits.CostBlockAboveUsd !== undefined ? { CostBlockAboveUsd: limits.CostBlockAboveUsd } : {}),
      CountedRunCount: 0,
    });
  }

  return rows.sort(
    (a, b) =>
      a.WorkflowName.localeCompare(b.WorkflowName, undefined, { sensitivity: 'base' }) ||
      a.WorkflowId.localeCompare(b.WorkflowId),
  );
}
