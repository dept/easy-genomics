process.env.NAME_PREFIX = 'unit-test';

import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { CostExplorerService } from '../../../../src/app/services/cost-explorer-service';
import { LaboratoryRunService } from '../../../../src/app/services/easy-genomics/laboratory-run-service';
import { RunCostSyncService } from '../../../../src/app/services/easy-genomics/run-cost-sync-service';

jest.mock('../../../../src/app/services/easy-genomics/laboratory-run-service');

describe('RunCostSyncService', () => {
  let mockListAll: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockGetCostAndUsage: jest.Mock;
  let costExplorer: CostExplorerService;
  let svc: RunCostSyncService;

  const daysAgoIso = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
    mockListAll = jest.fn().mockResolvedValue([]);
    mockUpdate = jest.fn().mockImplementation(async (r) => r);
    mockGetCostAndUsage = jest.fn();
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.listAllLaboratoryRuns =
      mockListAll;
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.update = mockUpdate;

    costExplorer = {
      getCostAndUsage: mockGetCostAndUsage,
    } as unknown as CostExplorerService;
    svc = new RunCostSyncService(costExplorer);
  });

  it('returns zeros when no terminal runs are in the age window', async () => {
    mockListAll.mockResolvedValue([
      { RunId: 'too-new', TerminalAt: daysAgoIso(1) },
      { RunId: 'too-old', TerminalAt: daysAgoIso(30) },
      { RunId: 'no-terminal' },
    ] as LaboratoryRun[]);

    const result = await svc.syncRecentTerminalRuns({ minAgeDays: 2, maxAgeDays: 14 });
    expect(result).toEqual({ matched: 0, updated: 0, pages: 0 });
    expect(mockGetCostAndUsage).not.toHaveBeenCalled();
  });

  it('skips recently-synced billed costs (staleness refresh)', async () => {
    mockListAll.mockResolvedValue([
      {
        RunId: 'fresh',
        TerminalAt: daysAgoIso(5),
        BilledCost: { TotalUsd: 1, AsOfDate: '2026-01-01', SyncedAt: daysAgoIso(1) },
      },
    ] as LaboratoryRun[]);

    const result = await svc.syncRecentTerminalRuns({ minAgeDays: 2, maxAgeDays: 14 });
    expect(result.pages).toBe(0);
    expect(mockGetCostAndUsage).not.toHaveBeenCalled();
  });

  it('parses RunId$ tag keys, retries on throttle, and returns real page count', async () => {
    mockListAll.mockResolvedValue([
      { RunId: 'run-1', TerminalAt: daysAgoIso(5), LaboratoryId: 'lab-1' },
    ] as LaboratoryRun[]);

    mockGetCostAndUsage
      .mockRejectedValueOnce({ name: 'LimitExceededException' })
      .mockResolvedValueOnce({
        ResultsByTime: [
          {
            Groups: [
              {
                Keys: ['RunId$run-1', 'AWS HealthOmics'],
                Metrics: { UnblendedCost: { Amount: '3.5' } },
              },
            ],
          },
        ],
        NextPageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        ResultsByTime: [
          {
            Groups: [
              {
                Keys: ['RunId$run-1', 'Amazon S3'],
                Metrics: { UnblendedCost: { Amount: '0.5' } },
              },
            ],
          },
        ],
      });

    const sleepSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    }) as any);

    try {
      const result = await svc.syncRecentTerminalRuns({ minAgeDays: 2, maxAgeDays: 14 });

      expect(result.matched).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.pages).toBe(2);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          RunId: 'run-1',
          BilledCost: expect.objectContaining({
            TotalUsd: 4,
            ByService: expect.objectContaining({
              'AWS HealthOmics': 3.5,
              'Amazon S3': 0.5,
            }),
          }),
        }),
      );
    } finally {
      sleepSpy.mockRestore();
    }
  });
});
