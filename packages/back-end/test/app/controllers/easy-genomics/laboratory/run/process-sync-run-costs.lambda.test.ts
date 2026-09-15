const mockSync = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/run-cost-sync-service', () => ({
  RunCostSyncService: jest.fn().mockImplementation(() => ({
    syncRecentTerminalRuns: (...args: unknown[]) => mockSync(...args),
  })),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-sync-run-costs.lambda';

describe('process-sync-run-costs.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue({ matched: 2, updated: 1, pages: 1 });
  });

  it('invokes RunCostSyncService and returns success payload', async () => {
    const result = await handler({}, {} as any, () => {});
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('Success');
    expect(body.matched).toBe(2);
    expect(body.updated).toBe(1);
    expect(mockSync).toHaveBeenCalled();
  });

  it('returns error response when sync throws', async () => {
    mockSync.mockRejectedValue(new Error('CE unavailable'));
    const result = await handler({}, {} as any, () => {});
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
  });
});
