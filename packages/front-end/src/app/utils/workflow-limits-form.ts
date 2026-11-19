import type { UpdateLaboratoryWorkflowRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import type {
  Laboratory,
  LaboratoryRunLimits,
  LaboratoryWorkflowCostRow,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { costLimitsOrderError, resolveCostLimits } from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';
import { AMOUNT_NOT_POSITIVE, formatRunLimit } from './usage-limits-form';

type WorkflowCostField = 'CostWarnAboveUsd' | 'CostBlockAboveUsd';

const WORKFLOW_COST_FIELDS: WorkflowCostField[] = ['CostWarnAboveUsd', 'CostBlockAboveUsd'];

/** What a workflow row's two inputs hold while it is being edited. */
export type WorkflowLimitsDraft = Record<WorkflowCostField, string>;

function parsedAmount(draft: WorkflowLimitsDraft, field: WorkflowCostField): number | undefined {
  const trimmed = draft[field].trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

export function workflowLimitsToDraft(row: LaboratoryWorkflowCostRow): WorkflowLimitsDraft {
  return {
    CostWarnAboveUsd: row.CostWarnAboveUsd === undefined ? '' : String(row.CostWarnAboveUsd),
    CostBlockAboveUsd: row.CostBlockAboveUsd === undefined ? '' : String(row.CostBlockAboveUsd),
  };
}

export function isWorkflowDraftChanged(row: LaboratoryWorkflowCostRow, draft: WorkflowLimitsDraft): boolean {
  const saved = workflowLimitsToDraft(row);
  return WORKFLOW_COST_FIELDS.some((field) => draft[field].trim() !== saved[field]);
}

/**
 * Checks the amounts that would apply after falling back to the lab's, with the server's
 * own order check, so the message shown here is the one the server would return.
 */
export function workflowDraftError(
  draft: WorkflowLimitsDraft,
  labLimits: LaboratoryRunLimits | undefined,
  workflowName: string,
): string | null {
  for (const field of WORKFLOW_COST_FIELDS) {
    const amount = parsedAmount(draft, field);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return AMOUNT_NOT_POSITIVE;
    }
  }
  const workflowAmounts = {
    CostWarnAboveUsd: parsedAmount(draft, 'CostWarnAboveUsd'),
    CostBlockAboveUsd: parsedAmount(draft, 'CostBlockAboveUsd'),
  };
  return costLimitsOrderError(resolveCostLimits(labLimits, workflowAmounts), workflowName);
}

/**
 * Blank amounts are omitted: the server clears any amount missing from the body, and
 * removes the workflow's limits when both are. Call only when workflowDraftError returns null.
 */
export function draftToWorkflowRequest(
  row: LaboratoryWorkflowCostRow,
  draft: WorkflowLimitsDraft,
): UpdateLaboratoryWorkflowRunLimits {
  const request: UpdateLaboratoryWorkflowRunLimits = {
    Platform: row.Platform,
    WorkflowId: row.WorkflowId,
    WorkflowName: row.WorkflowName,
  };
  for (const field of WORKFLOW_COST_FIELDS) {
    const amount = parsedAmount(draft, field);
    if (amount !== undefined) {
      request[field] = amount;
    }
  }
  return request;
}

export function labAmountPlaceholder(labAmount: number | undefined): string {
  return labAmount === undefined ? "Lab's: not set" : `Lab's ${formatRunLimit(labAmount, 'usd')}`;
}

export function typicalCostText(row: LaboratoryWorkflowCostRow): string {
  const cost = row.TypicalRunCostUsd;
  if (cost === undefined) return 'Not enough runs yet';
  const amount = Number.isInteger(cost)
    ? cost.toLocaleString('en-US')
    : cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Typical run ≈ US$${amount}`;
}

export function typicalCostTooltip(row: LaboratoryWorkflowCostRow): string {
  const runs = row.CountedRunCount;
  if (row.TypicalRunCostUsd !== undefined) {
    return `Median of the last ${runs} successful runs of this workflow in this lab. A run's estimate grows with its sample count, so a large run can cost well above this.`;
  }
  return `This workflow has ${runs} successful ${runs === 1 ? 'run' : 'runs'} in this lab. A cost limit applies once it has 3.`;
}

export function workflowsWithLimitsText(lab: Laboratory): string | null {
  const count = Object.keys(lab.WorkflowRunLimits ?? {}).length;
  if (count === 0) return null;
  return count === 1 ? '1 workflow with its own limits' : `${count} workflows with their own limits`;
}
