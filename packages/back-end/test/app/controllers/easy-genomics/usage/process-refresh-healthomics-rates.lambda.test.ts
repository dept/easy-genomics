process.env.REGION = 'us-west-2';

import { Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/process-refresh-healthomics-rates.lambda';

jest.mock('../../../../../src/app/services/aws-healthomics/healthomics-rates-service');

import { HealthOmicsRatesService } from '../../../../../src/app/services/aws-healthomics/healthomics-rates-service';

describe('process-refresh-healthomics-rates.lambda', () => {
  let refresh: jest.Mock;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    refresh = jest.fn();
    (HealthOmicsRatesService as jest.MockedClass<typeof HealthOmicsRatesService>).prototype.refresh = refresh;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => log.mockRestore());

  it("refreshes the deployment region's rates and logs the outcome with the publication date", async () => {
    refresh.mockResolvedValue({ outcome: 'updated', publicationDate: '2026-12-01T00:00:00Z' });

    const result = await handler({}, {} as Context, () => {});

    expect(refresh).toHaveBeenCalledWith('us-west-2');
    expect(result).toEqual({ outcome: 'updated', publicationDate: '2026-12-01T00:00:00Z' });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/us-west-2.*updated.*2026-12-01T00:00:00Z/));
  });

  it('does not throw for a rejected price list, which the service has already logged', async () => {
    refresh.mockResolvedValue({ outcome: 'rejected', reason: 'GET returned HTTP 503' });

    await expect(handler({}, {} as Context, () => {})).resolves.toEqual(
      expect.objectContaining({ outcome: 'rejected' }),
    );
  });

  it('throws when storing the rates fails, so the failure shows in the error metric', async () => {
    refresh.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(handler({}, {} as Context, () => {})).rejects.toThrow('AccessDeniedException');
  });
});
