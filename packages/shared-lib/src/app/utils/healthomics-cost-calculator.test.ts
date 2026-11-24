import { calculateHealthOmicsComputeCostUsd, calculateHealthOmicsStorageCostUsd } from './healthomics-cost-calculator';
import { HealthOmicsRegionRates } from './healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from './healthomics-rates.generated';

// Rates are read from the generated table, never typed in, so a price refresh never breaks these tests.
const hourly = (region: string, instanceType: string) =>
  HEALTHOMICS_RATES_BY_REGION[region].instanceHourlyUsd[instanceType];
const storageRate = (region: string, type: 'STATIC' | 'DYNAMIC') =>
  HEALTHOMICS_RATES_BY_REGION[region].runStorageGbHourUsd[type];

const START = '2026-01-01T00:00:00Z';
const ONE_HOUR_LATER = '2026-01-01T01:00:00Z';

const REFRESHED_RATES: HealthOmicsRegionRates = {
  publicationDate: '2026-12-01T00:00:00Z',
  sourceUrl: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonOmics/current/us-west-2/index.json',
  instanceHourlyUsd: { 'omics.c.large': 10 },
  runStorageGbHourUsd: { STATIC: 0.01, DYNAMIC: 0.02 },
};

const task = (overrides: Record<string, unknown> = {}) => ({
  instanceType: 'omics.c.large',
  startTime: START,
  stopTime: ONE_HOUR_LATER,
  status: 'COMPLETED',
  cacheHit: false,
  ...overrides,
});

describe('calculateHealthOmicsComputeCostUsd', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])('prices a %s task that ran', (status) => {
    expect(calculateHealthOmicsComputeCostUsd([task({ status })], 'us-east-1')).toBeCloseTo(
      hourly('us-east-1', 'omics.c.large'),
      4,
    );
  });

  it('adds nothing for a task that never started or never stopped', () => {
    const cost = calculateHealthOmicsComputeCostUsd(
      [task({ status: 'CANCELLED', startTime: undefined }), task({ status: 'FAILED', stopTime: null })],
      'us-east-1',
    );

    expect(cost).toBe(0);
  });

  it('adds nothing for a cache hit, and bills a short task for 60 seconds', () => {
    const cost = calculateHealthOmicsComputeCostUsd(
      [task({ cacheHit: true }), task({ stopTime: '2026-01-01T00:00:10Z' })],
      'us-east-1',
    );

    expect(cost).toBeCloseTo(hourly('us-east-1', 'omics.c.large') / 60, 4);
  });

  it("prices at the deployment region's own rates", () => {
    expect(hourly('ap-northeast-1', 'omics.c.large')).not.toBe(hourly('us-west-2', 'omics.c.large'));

    expect(calculateHealthOmicsComputeCostUsd([task()], 'us-west-2')).toBeCloseTo(
      hourly('us-west-2', 'omics.c.large'),
      4,
    );
    expect(calculateHealthOmicsComputeCostUsd([task()], 'ap-northeast-1')).toBeCloseTo(
      hourly('ap-northeast-1', 'omics.c.large'),
      4,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to us-east-1 rates in a region with none, and says so once', () => {
    const cost = calculateHealthOmicsComputeCostUsd([task(), task()], 'mars-north-1', 'run-123');

    expect(cost).toBeCloseTo(2 * hourly('us-east-1', 'omics.c.large'), 4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('mars-north-1'));
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('run-123'));
  });

  it('adds nothing for an instance type with no rate, and says so once per type', () => {
    const unknown = task({ instanceType: 'omics.z.huge' });
    const cost = calculateHealthOmicsComputeCostUsd([unknown, unknown, unknown, task()], 'us-east-1', 'run-123');

    expect(cost).toBeCloseTo(hourly('us-east-1', 'omics.c.large'), 4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('omics.z.huge'));
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('3 tasks'));
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('run-123'));
  });

  it('prices from rates passed in, not from the region in the generated table', () => {
    expect(calculateHealthOmicsComputeCostUsd([task()], 'us-west-2', 'run-123', REFRESHED_RATES)).toBeCloseTo(10, 4);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('calculateHealthOmicsStorageCostUsd', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const run = (storageType: string) => ({
    storageType,
    storageCapacity: 1200,
    startTime: START,
    stopTime: '2026-01-01T10:00:00Z',
  });

  it("prices static storage at the region's rate", () => {
    expect(calculateHealthOmicsStorageCostUsd(run('STATIC'), 'us-west-2')).toBeCloseTo(
      1200 * 10 * storageRate('us-west-2', 'STATIC'),
      4,
    );
  });

  it("prices dynamic storage at half its peak, at the region's rate", () => {
    expect(calculateHealthOmicsStorageCostUsd(run('DYNAMIC'), 'us-west-2')).toBeCloseTo(
      1200 * 10 * 0.5 * storageRate('us-west-2', 'DYNAMIC'),
      4,
    );
  });

  it('falls back to us-east-1 rates in a region with none, and says so', () => {
    const cost = calculateHealthOmicsStorageCostUsd(run('STATIC'), 'mars-north-1', 'run-123');

    expect(cost).toBeCloseTo(1200 * 10 * storageRate('us-east-1', 'STATIC'), 4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('mars-north-1'));
  });

  it('prices from rates passed in, not from the region in the generated table', () => {
    expect(calculateHealthOmicsStorageCostUsd(run('STATIC'), 'mars-north-1', 'run-123', REFRESHED_RATES)).toBeCloseTo(
      1200 * 10 * 0.01,
      4,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
