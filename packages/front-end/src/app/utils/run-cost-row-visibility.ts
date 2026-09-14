import { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE } from '@easy-genomics/shared-lib/src/app/utils/run-cost-thresholds';

type RunCostCandidate = Pick<LaboratoryRun, 'BilledCost' | 'RunCostOutcome' | 'PreRunCostEstimate'> | null | undefined;

/**
 * Whether an estimate is backed by enough comparable runs to be worth showing. The estimator
 * already withholds bands below the minimum sample size; re-checking the count here also
 * covers snapshots persisted before the threshold existed.
 */
function hasMinimumSampleSize(comparableRunCount: number | undefined): boolean {
  return comparableRunCount != null && comparableRunCount >= MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE;
}

/**
 * Whether the pre-launch estimate has a compute cost band to display.
 */
export function hasPreLaunchCostEstimate(estimate: EstimateRunCostResponse | null | undefined): boolean {
  if (!estimate?.estimateAvailable || !estimate.computeCostUsd) return false;

  return hasMinimumSampleSize(estimate.comparableRunCount);
}

/**
 * Whether a launched run has a cost figure to display: a billed total, a captured platform
 * outcome, or the pre-run estimate snapshot taken at launch.
 */
export function hasRunCostAmount(labRun: RunCostCandidate): boolean {
  if (!labRun) return false;
  if (labRun.BilledCost) return true;
  if (labRun.RunCostOutcome?.ActualComputeCostUsd != null) return true;

  return hasMinimumSampleSize(labRun.PreRunCostEstimate?.ComparableRunCount);
}

/**
 * Whether the cost row has a real amount to show. A workflow needs at least
 * MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE successful runs before an estimate exists, so until
 * then the row is hidden rather than rendering a placeholder that reads as a stalled job.
 */
export function showRunCostRow(content: {
  estimate?: EstimateRunCostResponse | null;
  labRun?: RunCostCandidate;
  loading?: boolean;
}): boolean {
  if (content.loading) return true;
  if (content.labRun) return hasRunCostAmount(content.labRun);

  return hasPreLaunchCostEstimate(content.estimate);
}
