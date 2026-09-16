import { MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE } from '@easy-genomics/shared-lib/src/app/constants/run-cost';
import { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { resolveRunCostSource, showRunCostRow } from '../../../src/app/utils/run-cost-row-visibility';

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

describe('resolveRunCostSource', () => {
  it('returns preLaunch when no run exists', () => {
    expect(resolveRunCostSource(null)).toBe('preLaunch');
    expect(resolveRunCostSource(undefined)).toBe('preLaunch');
  });

  it('prefers billed cost over outcome and pre-run estimate', () => {
    expect(
      resolveRunCostSource({
        BilledCost: { TotalUsd: 12.5, AsOfDate: '2026-09-10', SyncedAt: '2026-09-11' },
        RunCostOutcome: {
          ActualComputeCostUsd: 8,
          CostSource: 'HEALTHOMICS_TASKS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
        PreRunCostEstimate: preRunEstimate,
      }),
    ).toBe('billed');
  });

  it('returns outcome when compute cost was captured and nothing is billed yet', () => {
    expect(
      resolveRunCostSource({
        RunCostOutcome: {
          ActualComputeCostUsd: 0,
          CostSource: 'SEQERA_PROGRESS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ).toBe('outcome');
  });

  it('returns preRun when the snapshot meets the minimum sample size', () => {
    expect(resolveRunCostSource({ PreRunCostEstimate: preRunEstimate })).toBe('preRun');
  });

  it('returns pending for an undersized pre-run snapshot', () => {
    expect(
      resolveRunCostSource({
        PreRunCostEstimate: { ...preRunEstimate, ComparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1 },
      }),
    ).toBe('pending');
  });

  it('returns pending when the outcome only captured storage', () => {
    expect(
      resolveRunCostSource({
        RunCostOutcome: {
          ActualStorageCostUsd: 2,
          CostSource: 'HEALTHOMICS_TASKS',
          CostCapturedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ).toBe('pending');
  });

  it('returns pending when the run has no cost data', () => {
    expect(resolveRunCostSource({})).toBe('pending');
  });
});

describe('showRunCostRow', () => {
  it('hides the row before a workflow has the minimum run history', () => {
    expect(
      showRunCostRow({
        estimate: estimateResponse({
          estimateAvailable: false,
          confidence: 'NONE',
          comparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1,
          computeCostUsd: undefined,
        }),
      }),
    ).toBe(false);
  });

  it('hides an otherwise available estimate that reports fewer comparable runs than the minimum', () => {
    expect(
      showRunCostRow({
        estimate: estimateResponse({ comparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1 }),
      }),
    ).toBe(false);
  });

  it('shows the row once the pre-launch estimate is available', () => {
    expect(showRunCostRow({ estimate: estimateResponse() })).toBe(true);
  });

  it('hides an unavailable estimate and one without a cost band', () => {
    expect(
      showRunCostRow({
        estimate: estimateResponse({
          estimateAvailable: false,
          confidence: 'NONE',
          comparableRunCount: 0,
          computeCostUsd: undefined,
        }),
      }),
    ).toBe(false);
    expect(showRunCostRow({ estimate: estimateResponse({ computeCostUsd: undefined }) })).toBe(false);
  });

  it('keeps the row visible while the estimate is being fetched', () => {
    expect(showRunCostRow({ estimate: null, loading: true })).toBe(true);
  });

  it('keeps the row visible while a launched run is refreshing', () => {
    expect(showRunCostRow({ loading: true, labRun: {} })).toBe(true);
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

  it('shows the row for a launched run with a captured platform outcome', () => {
    expect(
      showRunCostRow({
        labRun: {
          RunCostOutcome: {
            ActualComputeCostUsd: 8,
            CostSource: 'HEALTHOMICS_TASKS',
            CostCapturedAt: '2026-09-10T00:00:00.000Z',
          },
        },
      }),
    ).toBe(true);
  });

  it('shows the row for a launched run with a qualifying pre-run snapshot', () => {
    expect(showRunCostRow({ labRun: { PreRunCostEstimate: preRunEstimate } })).toBe(true);
  });

  it('hides the row for an undersized pre-run snapshot', () => {
    expect(
      showRunCostRow({
        labRun: {
          PreRunCostEstimate: { ...preRunEstimate, ComparableRunCount: MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE - 1 },
        },
      }),
    ).toBe(false);
  });

  it('ignores a stale pre-launch estimate once the run exists', () => {
    expect(showRunCostRow({ estimate: estimateResponse(), labRun: {} })).toBe(false);
  });
});
