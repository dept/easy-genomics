import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { applyToLedger, ledgerParamName, loadLedger } from '../../../scripts/deploy-migrations/ledger';
import { SsmService } from '../../../src/app/services/ssm-service';

function buildSsmService(): jest.Mocked<SsmService> {
  return {
    getParameter: jest.fn(),
    putParameter: jest.fn(),
    deleteParameter: jest.fn(),
  } as unknown as jest.Mocked<SsmService>;
}

describe('ledgerParamName', () => {
  it('builds the SSM path from NAME_PREFIX', () => {
    expect(ledgerParamName('dev-mylab')).toBe('/dev-mylab/deploy-migrations/applied');
  });
});

describe('loadLedger', () => {
  it('returns the parsed ledger when the parameter exists', async () => {
    const ssmService = buildSsmService();
    ssmService.getParameter.mockResolvedValue({
      Parameter: { Value: JSON.stringify({ 'id-a': { appliedAt: '2026-01-01T00:00:00.000Z' } }) },
    } as any);

    const ledger = await loadLedger(ssmService, 'dev-mylab');

    expect(ledger).toEqual({ 'id-a': { appliedAt: '2026-01-01T00:00:00.000Z' } });
    expect(ssmService.getParameter).toHaveBeenCalledWith({ Name: '/dev-mylab/deploy-migrations/applied' });
  });

  it('returns an empty ledger when the parameter is missing', async () => {
    const ssmService = buildSsmService();
    ssmService.getParameter.mockRejectedValue(new ParameterNotFound({ message: 'not found', $metadata: {} }));

    const ledger = await loadLedger(ssmService, 'dev-mylab');

    expect(ledger).toEqual({});
  });

  it('rethrows non-ParameterNotFound errors', async () => {
    const ssmService = buildSsmService();
    ssmService.getParameter.mockRejectedValue(new Error('access denied'));

    await expect(loadLedger(ssmService, 'dev-mylab')).rejects.toThrow('access denied');
  });
});

describe('applyToLedger', () => {
  it('merges the id into the existing ledger and writes it back', async () => {
    const ssmService = buildSsmService();
    const existing = { 'id-a': { appliedAt: '2026-01-01T00:00:00.000Z' } };
    ssmService.getParameter
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(existing) } } as any)
      .mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify({ ...existing, 'id-b': { appliedAt: '2026-02-02T00:00:00.000Z' } }) },
      } as any);
    ssmService.putParameter.mockResolvedValue({} as any);
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-02-02T00:00:00.000Z');

    await applyToLedger(ssmService, 'dev-mylab', 'id-b');

    expect(ssmService.putParameter).toHaveBeenCalledWith({
      Name: '/dev-mylab/deploy-migrations/applied',
      Type: 'String',
      Overwrite: true,
      Value: JSON.stringify({ ...existing, 'id-b': { appliedAt: '2026-02-02T00:00:00.000Z' } }),
    });
  });

  it('retries then throws if the confirm-read never shows the merged id', async () => {
    const ssmService = buildSsmService();
    ssmService.getParameter.mockResolvedValue({ Parameter: { Value: JSON.stringify({}) } } as any);
    ssmService.putParameter.mockResolvedValue({} as any);

    await expect(applyToLedger(ssmService, 'dev-mylab', 'id-b')).rejects.toThrow(
      "Concurrent writer detected while applying ledger entry 'id-b'",
    );
    // 3 attempts total, each doing (read, put, confirm-read) = 3*2 = 6 getParameter calls
    expect(ssmService.getParameter).toHaveBeenCalledTimes(6);
  });
});
