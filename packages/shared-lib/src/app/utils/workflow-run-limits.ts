import { LaboratoryRunLimits, WorkflowCostLimits } from '../types/easy-genomics/laboratory';
import { LaboratoryWorkflowAccessPlatform } from '../types/easy-genomics/laboratory-workflow-access';

export type CostLimitSource = 'lab' | 'workflow';

export type ResolvedCostLimits = {
  warnAbove?: { amount: number; source: CostLimitSource };
  blockAbove?: { amount: number; source: CostLimitSource };
};

export function workflowRunLimitsKey(platform: LaboratoryWorkflowAccessPlatform, workflowId: string): string {
  return `${platform}#${workflowId}`;
}

function resolveAmount(
  labAmount: number | undefined,
  workflowAmount: number | undefined,
): { amount: number; source: CostLimitSource } | undefined {
  if (workflowAmount !== undefined) {
    return { amount: workflowAmount, source: 'workflow' };
  }
  if (labAmount !== undefined) {
    return { amount: labAmount, source: 'lab' };
  }
  return undefined;
}

/** Each field is the workflow's amount when set, otherwise the lab's. */
export function resolveCostLimits(
  lab?: LaboratoryRunLimits,
  workflow?: Pick<WorkflowCostLimits, 'CostWarnAboveUsd' | 'CostBlockAboveUsd'>,
): ResolvedCostLimits {
  const resolved: ResolvedCostLimits = {};
  const warnAbove = resolveAmount(lab?.CostWarnAboveUsd, workflow?.CostWarnAboveUsd);
  const blockAbove = resolveAmount(lab?.CostBlockAboveUsd, workflow?.CostBlockAboveUsd);
  if (warnAbove) {
    resolved.warnAbove = warnAbove;
  }
  if (blockAbove) {
    resolved.blockAbove = blockAbove;
  }
  return resolved;
}

function formatAmountUsd(amount: number, withCents: boolean): string {
  return withCents
    ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.toLocaleString('en-US');
}

function describeAmount(limit: { amount: number; source: CostLimitSource }, withCents: boolean): string {
  const owner = limit.source === 'lab' ? "the lab's" : "the workflow's";
  return `US$${formatAmountUsd(limit.amount, withCents)}, ${owner}`;
}

/** Null when either amount is missing or the block amount is above the warn amount. */
export function costLimitsOrderError(resolved: ResolvedCostLimits, workflowName: string): string | null {
  const { warnAbove, blockAbove } = resolved;
  if (!warnAbove || !blockAbove || blockAbove.amount > warnAbove.amount) {
    return null;
  }
  // Both amounts share one format, so US$99.00 vs US$99.50 doesn't read as US$99 vs US$99.50.
  const withCents = !Number.isInteger(warnAbove.amount) || !Number.isInteger(blockAbove.amount);
  return `For ${workflowName}, block above (${describeAmount(blockAbove, withCents)}) must be higher than warn above (${describeAmount(warnAbove, withCents)}) for estimated cost per run.`;
}
