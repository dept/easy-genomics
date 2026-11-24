import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

jest.mock('dotenv', () => ({ config: jest.fn() }));

import { selectRunsToCount } from '../../scripts/backfill-usage-daily-totals';

function buildRun(overrides: Partial<LaboratoryRun> = {}): LaboratoryRun {
  return {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    UserId: 'user-1',
    OrganizationId: 'org-1',
    RunName: 'Test Run',
    Platform: 'AWS HealthOmics',
    Status: 'COMPLETED',
    Owner: 'owner-1',
    RunCostOutcome: {
      ActualComputeCostUsd: 1.5,
      CostSource: 'HEALTHOMICS_TASKS',
      CostCapturedAt: '2026-11-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('selectRunsToCount', () => {
  it('picks terminal runs with a captured cost that were never counted', () => {
    const completed = buildRun({ RunId: 'completed' });
    const failed = buildRun({ RunId: 'failed', Status: 'FAILED' });

    expect(selectRunsToCount([completed, failed])).toEqual([completed, failed]);
  });

  it.each([
    ['a run that is still running', buildRun({ Status: 'RUNNING' })],
    ['a run with no captured cost', buildRun({ RunCostOutcome: undefined })],
    ['a run already counted', buildRun({ RunCostCountedAt: '2026-11-02T00:00:00.000Z' })],
  ])('skips %s', (_label, run) => {
    expect(selectRunsToCount([run])).toEqual([]);
  });
});
