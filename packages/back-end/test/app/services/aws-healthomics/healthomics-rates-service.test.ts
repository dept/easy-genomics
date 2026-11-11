process.env.NAME_PREFIX = 'unit-test';

import fs from 'fs';
import path from 'path';
import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { HealthOmicsRegionRates } from '@easy-genomics/shared-lib/src/app/utils/healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from '@easy-genomics/shared-lib/src/app/utils/healthomics-rates.generated';
import {
  HealthOmicsRatesService,
  validateRefreshedRates,
} from '../../../../src/app/services/aws-healthomics/healthomics-rates-service';
import { SsmService } from '../../../../src/app/services/ssm-service';

jest.mock('../../../../src/app/services/ssm-service');

const PARAMETER_NAME = '/unit-test/healthomics-rates/current';
const REGION = 'us-west-2';
const PRICE_LIST_URL = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonOmics/current/${REGION}/index.json`;

// A trimmed copy of AWS's real us-west-2 HealthOmics price list (published 2026-09-11).
const PRICE_LIST_SAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/healthomics-price-list-us-west-2.json'), 'utf-8'),
);
const SAMPLE_PUBLICATION_DATE: string = PRICE_LIST_SAMPLE.publicationDate;

const BAKED = HEALTHOMICS_RATES_BY_REGION[REGION];
const STORED: HealthOmicsRegionRates = {
  ...BAKED,
  publicationDate: '2026-12-01T00:00:00Z',
  instanceHourlyUsd: { ...BAKED.instanceHourlyUsd, 'omics.c.large': 99 },
};

function priceListResponse(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body } as Response;
}

function withInstanceCount(rates: HealthOmicsRegionRates, count: number): HealthOmicsRegionRates {
  const kept = Object.entries(rates.instanceHourlyUsd).slice(0, count);
  return { ...rates, instanceHourlyUsd: Object.fromEntries(kept) };
}

describe('HealthOmicsRatesService', () => {
  let ssmService: jest.Mocked<SsmService>;
  let fetchPriceList: jest.Mock;
  let service: HealthOmicsRatesService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    ssmService = new SsmService() as jest.Mocked<SsmService>;
    ssmService.getParameter = jest.fn();
    ssmService.putParameter = jest.fn().mockResolvedValue({});
    fetchPriceList = jest.fn().mockResolvedValue(priceListResponse(PRICE_LIST_SAMPLE));
    service = new HealthOmicsRatesService({ ssmService, fetch: fetchPriceList });
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  const storedParameter = (rates: unknown) =>
    ssmService.getParameter.mockResolvedValue({ Parameter: { Value: JSON.stringify(rates) }, $metadata: {} });

  describe('getRates', () => {
    it('returns the stored rates', async () => {
      storedParameter(STORED);

      await expect(service.getRates(REGION)).resolves.toEqual(STORED);
      expect(ssmService.getParameter).toHaveBeenCalledWith({ Name: PARAMETER_NAME });
    });

    it.each([
      ['the parameter is missing', () => new ParameterNotFound({ message: 'missing', $metadata: {} })],
      ['the read fails', () => new Error('AccessDenied')],
    ])('returns the baked rates and says so once when %s', async (_case, failure) => {
      ssmService.getParameter.mockRejectedValue(failure());

      await expect(service.getRates(REGION)).resolves.toEqual(BAKED);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining(PARAMETER_NAME));
    });

    it('ignores stored rates when the refresh is turned off, so a newer release table wins', async () => {
      process.env.HEALTHOMICS_RATES_REFRESH_ENABLED = 'false';
      try {
        storedParameter(STORED);

        await expect(service.getRates(REGION)).resolves.toEqual(BAKED);
        expect(ssmService.getParameter).not.toHaveBeenCalled();
      } finally {
        delete process.env.HEALTHOMICS_RATES_REFRESH_ENABLED;
      }
    });

    it('returns the baked rates and says so once when the stored JSON is invalid', async () => {
      storedParameter({ publicationDate: '2026-12-01T00:00:00Z' });

      await expect(service.getRates(REGION)).resolves.toEqual(BAKED);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('reads the parameter once an hour', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(0);
      storedParameter(STORED);

      await service.getRates(REGION);
      now.mockReturnValue(59 * 60 * 1000);
      await service.getRates(REGION);
      expect(ssmService.getParameter).toHaveBeenCalledTimes(1);

      now.mockReturnValue(61 * 60 * 1000);
      await service.getRates(REGION);
      expect(ssmService.getParameter).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh', () => {
    it('writes the parsed rates when the publication date changed', async () => {
      storedParameter(STORED);

      const result = await service.refresh(REGION);

      expect(fetchPriceList).toHaveBeenCalledWith(PRICE_LIST_URL);
      expect(result).toEqual({ outcome: 'updated', publicationDate: SAMPLE_PUBLICATION_DATE });
      const written = ssmService.putParameter.mock.calls[0][0];
      expect(written).toEqual(
        expect.objectContaining({ Name: PARAMETER_NAME, Type: 'String', Tier: 'Standard', Overwrite: true }),
      );
      const writtenRates = JSON.parse(written.Value!);
      expect(writtenRates.publicationDate).toBe(SAMPLE_PUBLICATION_DATE);
      expect(writtenRates.instanceHourlyUsd['omics.c.large']).toBe(BAKED.instanceHourlyUsd['omics.c.large']);
    });

    it('writes the parsed rates when none are stored yet', async () => {
      ssmService.getParameter.mockRejectedValue(new ParameterNotFound({ message: 'missing', $metadata: {} }));

      await expect(service.refresh(REGION)).resolves.toEqual(
        expect.objectContaining({ outcome: 'updated' }),
      );
      expect(ssmService.putParameter).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the publication date is unchanged', async () => {
      storedParameter({ ...STORED, publicationDate: SAMPLE_PUBLICATION_DATE });

      await expect(service.refresh(REGION)).resolves.toEqual({
        outcome: 'unchanged',
        publicationDate: SAMPLE_PUBLICATION_DATE,
      });
      expect(ssmService.putParameter).not.toHaveBeenCalled();
    });

    it('rejects a failed download without writing', async () => {
      storedParameter(STORED);
      fetchPriceList.mockResolvedValue(priceListResponse({}, 503));

      const result = await service.refresh(REGION);

      expect(result).toEqual(expect.objectContaining({ outcome: 'rejected', reason: expect.stringContaining('503') }));
      expect(ssmService.putParameter).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('503'));
    });

    it('rejects a price list that does not parse without writing', async () => {
      storedParameter(STORED);
      fetchPriceList.mockResolvedValue(priceListResponse({ hello: 'world' }));

      const result = await service.refresh(REGION);

      expect(result).toEqual(expect.objectContaining({ outcome: 'rejected', reason: expect.stringContaining(PRICE_LIST_URL) }));
      expect(ssmService.putParameter).not.toHaveBeenCalled();
    });
  });
});

describe('validateRefreshedRates', () => {
  const candidate: HealthOmicsRegionRates = { ...BAKED, publicationDate: '2027-01-01T00:00:00Z' };

  it('accepts new rates with as many instance types as the baked table', () => {
    expect(validateRefreshedRates(candidate, BAKED, STORED)).toEqual({ outcome: 'updated' });
  });

  it('accepts new rates when nothing is stored or baked for the region', () => {
    expect(validateRefreshedRates(candidate, undefined, undefined)).toEqual({ outcome: 'updated' });
  });

  it('reports an unchanged publication date', () => {
    expect(validateRefreshedRates(candidate, BAKED, candidate)).toEqual(
      expect.objectContaining({ outcome: 'unchanged' }),
    );
  });

  it.each(['STATIC', 'DYNAMIC'] as const)('rejects a zero %s storage rate', (storageType) => {
    const zeroStorage = { ...candidate, runStorageGbHourUsd: { ...candidate.runStorageGbHourUsd, [storageType]: 0 } };

    expect(validateRefreshedRates(zeroStorage, BAKED, STORED)).toEqual({
      outcome: 'rejected',
      reason: expect.stringContaining(storageType),
    });
  });

  it('rejects fewer than 80% of the baked instance types, and accepts exactly 80%', () => {
    const bakedCount = Object.keys(BAKED.instanceHourlyUsd).length;
    const floor = Math.ceil(bakedCount * 0.8);

    expect(validateRefreshedRates(withInstanceCount(candidate, floor - 1), BAKED, STORED)).toEqual({
      outcome: 'rejected',
      reason: expect.stringContaining(`${floor - 1} instance types`),
    });
    expect(validateRefreshedRates(withInstanceCount(candidate, floor), BAKED, STORED)).toEqual({ outcome: 'updated' });
  });
});

describe('stored rates size', () => {
  it('keeps every region inside the 4 KB SSM Standard tier', () => {
    const largest = Math.max(
      ...Object.values(HEALTHOMICS_RATES_BY_REGION).map((rates) => Buffer.byteLength(JSON.stringify(rates))),
    );

    expect(largest).toBeLessThan(4096);
  });
});
