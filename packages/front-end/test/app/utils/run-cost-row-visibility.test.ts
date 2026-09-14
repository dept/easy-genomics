import { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE } from '@easy-genomics/shared-lib/src/app/utils/run-cost-thresholds';
import {
  hasPreLaunchCostEstimate,
  hasRunCostAmount,
  showRunCostRow,
} from '../../../src/app/utils/run-cost-row-visibility';

function estimateResponse(overrides: Partial<EstimateRunCostResponse> = {}): EstimateRunCostResponse {
  return {
    estimateAvailable: true,
    confidence: 'MEDIUM',
    comparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE,
    computeCostUsd: { low: 4, median: 5, high: 6 },
    currency: 'USD',
    label: 'Estimated compute cost',
    disclaimer: 'Estimated compute cost based on similar completed runs of this workflow.',
    exclusions: ['S3', 'DATA_TRANSFER', 'RUN_STORAGE'],
    ...overrides,
  };
}

const preRunEstimate = {
  LowUsd: 4,
  HighUsd: 6,
  MedianUsd: 5,
  Confidence: 'MEDIUM' as const,
  ComparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE,
  EstimatedAt: '2026-09-01T00:00:00.000Z',
  Exclusions: ['S3'],
};

describe('hasPreLaunchCostEstimate', () => {
  it('accepts an estimate backed by the minimum number of comparable runs', () => {
    expect(hasPreLaunchCostEstimate(estimateResponse())).toBe(true);
  });

  it('rejects an estimate with fewer comparable runs than the minimum', () => {
    expect(
      hasPreLaunchCostEstimate(estimateResponse({ comparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1 })),
    ).toBe(false);
  });

  it('rejects an unavailable estimate and one without a cost band', () => {
    expect(
      hasPreLaunchCostEstimate(
        estimateResponse({
          estimateAvailable: false,
          confidence: 'NONE',
          comparableRunCount: 0,
          computeCostUsd: undefined,
        }),
      ),
    ).toBe(false);
    expect(hasPreLaunchCostEstimate(estimateResponse({ computeCostUsd: undefined }))).toBe(false);
  });

  it('rejects a missing estimate', () => {
    expect(hasPreLaunchCostEstimate(null)).toBe(false);
    expect(hasPreLaunchCostEstimate(undefined)).toBe(false);
  });
});

describe('hasRunCostAmount', () => {
  it('accepts a billed cost', () => {
    expect(hasRunCostAmount({ BilledCost: { TotalUsd: 12.5, AsOfDate: '2026-09-10', SyncedAt: '2026-09-11' } })).toBe(
      true,
    );
  });

  it('accepts a captured platform outcome', () => {
    expect(
      hasRunCostAmount({
        RunCostOutcome: {
          ActualComputeCostUsd: 8,
          CostSource: 'HEALTHOMICS_TASKS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ).toBe(true);
  });

  it('accepts a zero-cost outcome, which is a real amount', () => {
    expect(
      hasRunCostAmount({
        RunCostOutcome: {
          ActualComputeCostUsd: 0,
          CostSource: 'SEQERA_PROGRESS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ).toBe(true);
  });

  it('accepts the pre-run estimate snapshot taken at launch', () => {
    expect(hasRunCostAmount({ PreRunCostEstimate: preRunEstimate })).toBe(true);
  });

  it('rejects a pre-run snapshot taken from too few comparable runs', () => {
    expect(
      hasRunCostAmount({
        PreRunCostEstimate: { ...preRunEstimate, ComparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1 },
      }),
    ).toBe(false);
  });

  it('rejects an outcome that only captured storage cost', () => {
    expect(
      hasRunCostAmount({
        RunCostOutcome: {
          ActualStorageCostUsd: 2,
          CostSource: 'HEALTHOMICS_TASKS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ).toBe(false);
  });

  it('rejects a run with no cost data at all', () => {
    expect(hasRunCostAmount({})).toBe(false);
    expect(hasRunCostAmount(null)).toBe(false);
  });
});

describe('showRunCostRow', () => {
  it('hides the row before a workflow has the minimum run history', () => {
    expect(
      showRunCostRow({
        estimate: estimateResponse({
          estimateAvailable: false,
          confidence: 'NONE',
          comparableRunCount: 2,
          computeCostUsd: undefined,
        }),
      }),
    ).toBe(false);
  });

  it('shows the row once the pre-launch estimate is available', () => {
    expect(showRunCostRow({ estimate: estimateResponse() })).toBe(true);
  });

  it('keeps the row visible while the estimate is being fetched', () => {
    expect(showRunCostRow({ estimate: null, loading: true })).toBe(true);
  });

  it('hides the row when the estimate request returned nothing', () => {
    expect(showRunCostRow({ estimate: null })).toBe(false);
    expect(showRunCostRow({})).toBe(false);
  });

  it('hides the row for a launched run whose cost is still pending', () => {
    expect(showRunCostRow({ labRun: {} })).toBe(false);
  });

  it('shows the row for a launched run with a billed cost', () => {
    expect(
      showRunCostRow({
        labRun: { BilledCost: { TotalUsd: 12.5, AsOfDate: '2026-09-10', SyncedAt: '2026-09-11' } },
      }),
    ).toBe(true);
  });

  it('ignores a stale pre-launch estimate once the run exists', () => {
    expect(showRunCostRow({ estimate: estimateResponse(), labRun: {} })).toBe(false);
  });
});
