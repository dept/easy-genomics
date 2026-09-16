import { MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE } from '@easy-genomics/shared-lib/src/app/constants/run-cost';
import { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

type RunCostCandidate = Pick<LaboratoryRun, 'BilledCost' | 'RunCostOutcome' | 'PreRunCostEstimate'> | null | undefined;

export type RunCostSource = 'billed' | 'outcome' | 'preRun' | 'pending' | 'preLaunch';

/**
 * Whether an estimate is backed by enough comparable runs to be worth showing. The estimator
 * already withholds bands below the minimum sample size; re-checking the count here also
 * covers snapshots persisted before the threshold existed.
 */
function hasMinimumSampleSize(comparableRunCount: number | undefined): boolean {
  return comparableRunCount != null && comparableRunCount >= MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE;
}

/**
 * Single billed → outcome → pre-run → pending cascade for a launched run.
 * Undersized pre-run snapshots are treated as pending so visibility and display
 * cannot disagree about whether a figure exists.
 */
export function resolveRunCostSource(labRun: RunCostCandidate): RunCostSource {
  if (!labRun) return 'preLaunch';
  if (labRun.BilledCost) return 'billed';
  if (labRun.RunCostOutcome?.ActualComputeCostUsd != null) return 'outcome';
  if (hasMinimumSampleSize(labRun.PreRunCostEstimate?.ComparableRunCount)) return 'preRun';
  return 'pending';
}

function hasPreLaunchCostEstimate(estimate: EstimateRunCostResponse | null | undefined): boolean {
  if (!estimate?.estimateAvailable || !estimate.computeCostUsd) return false;

  return hasMinimumSampleSize(estimate.comparableRunCount);
}

function hasRunCostAmount(labRun: RunCostCandidate): boolean {
  const source = resolveRunCostSource(labRun);
  return source !== 'pending' && source !== 'preLaunch';
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
