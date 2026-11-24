import { HealthOmicsRegionRatesSchema, parseHealthOmicsPriceList } from './healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from './healthomics-rates.generated';

const SOURCE_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonOmics/current/us-west-2/index.json';

function priced(usagetype: string, usd: string) {
  return {
    product: { sku: usagetype, attributes: { usagetype } },
    term: { [`${usagetype}.TERM`]: { priceDimensions: { [`${usagetype}.DIM`]: { pricePerUnit: { USD: usd } } } } },
  };
}

function offer(entries: ReturnType<typeof priced>[]) {
  return {
    publicationDate: '2026-09-11T12:44:59Z',
    products: Object.fromEntries(entries.map((e) => [e.product.sku, e.product])),
    terms: { OnDemand: Object.fromEntries(entries.map((e) => [e.product.sku, e.term])) },
  };
}

const INSTANCE_AND_STORAGE = [
  priced('USW2-WorkflowType:Private-omics.c.large-hours', '0.1148000000'),
  priced('USW2-WorkflowType:Private-omics.g6e.xlarge-hours', '2.1000000000'),
  priced('USW2-WorkflowType:Private-RunStorage-GB-hour', '0.0001918000'),
  priced('USW2-WorkflowType:Private-DynamicRunStorage-Bytes-hour', '0.0004110000'),
];

describe('parseHealthOmicsPriceList', () => {
  it('reads private-workflow instance and run-storage rates', () => {
    const rates = parseHealthOmicsPriceList(offer(INSTANCE_AND_STORAGE), SOURCE_URL);

    expect(rates).toEqual({
      publicationDate: '2026-09-11T12:44:59Z',
      sourceUrl: SOURCE_URL,
      instanceHourlyUsd: { 'omics.c.large': 0.1148, 'omics.g6e.xlarge': 2.1 },
      runStorageGbHourUsd: { STATIC: 0.0001918, DYNAMIC: 0.000411 },
    });
  });

  it('ignores Ready2Run, storage-class and API-request prices in the same file', () => {
    const rates = parseHealthOmicsPriceList(
      offer([
        ...INSTANCE_AND_STORAGE,
        priced('USW2-AnalyticsType:Annotation-Bytes-hour', '0.035'),
        priced('USW2-OmicsStorage:API-GetRequest', '0.000005'),
        priced('USW2-WorkflowType:Ready2Run-SomeWorkflow-Run', '10.0'),
      ]),
      SOURCE_URL,
    );

    expect(Object.keys(rates.instanceHourlyUsd)).toEqual(['omics.c.large', 'omics.g6e.xlarge']);
  });

  it('refuses a file with no run-storage rate, naming the source', () => {
    expect(() => parseHealthOmicsPriceList(offer(INSTANCE_AND_STORAGE.slice(0, 3)), SOURCE_URL)).toThrow(SOURCE_URL);
  });

  it('refuses a file with no instance rates, naming the source', () => {
    expect(() => parseHealthOmicsPriceList(offer(INSTANCE_AND_STORAGE.slice(2)), SOURCE_URL)).toThrow(SOURCE_URL);
  });

  it('refuses something that is not a price list', () => {
    expect(() => parseHealthOmicsPriceList({ hello: 'world' }, SOURCE_URL)).toThrow(SOURCE_URL);
  });
});

describe('HealthOmicsRegionRatesSchema', () => {
  const usWest2 = HEALTHOMICS_RATES_BY_REGION['us-west-2'];

  it.each(Object.keys(HEALTHOMICS_RATES_BY_REGION))('accepts the generated rates for %s', (region) => {
    expect(HealthOmicsRegionRatesSchema.safeParse(HEALTHOMICS_RATES_BY_REGION[region]).success).toBe(true);
  });

  it('rejects rates with no instance prices field', () => {
    const withoutInstances: Partial<typeof usWest2> = { ...usWest2 };
    delete withoutInstances.instanceHourlyUsd;
    expect(HealthOmicsRegionRatesSchema.safeParse(withoutInstances).success).toBe(false);
  });

  it('rejects a negative price', () => {
    const negative = { ...usWest2, instanceHourlyUsd: { ...usWest2.instanceHourlyUsd, 'omics.c.large': -1 } };
    expect(HealthOmicsRegionRatesSchema.safeParse(negative).success).toBe(false);
  });
});
