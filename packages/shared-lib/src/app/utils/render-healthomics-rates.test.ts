import { HealthOmicsRegionRates } from './healthomics-price-list';
import { renderHealthOmicsRatesModule } from './render-healthomics-rates';

const region = (instanceHourlyUsd: Record<string, number>): HealthOmicsRegionRates => ({
  publicationDate: '2026-09-11T12:44:59Z',
  sourceUrl: 'https://example.test/index.json',
  instanceHourlyUsd,
  runStorageGbHourUsd: { STATIC: 0.0001918, DYNAMIC: 0.000411 },
});

describe('renderHealthOmicsRatesModule', () => {
  it('renders the same text whatever order regions and instance types arrive in', () => {
    const first = renderHealthOmicsRatesModule({
      'us-west-2': region({ 'omics.m.large': 0.1296, 'omics.c.large': 0.1148 }),
      'eu-west-1': region({ 'omics.c.large': 0.13 }),
    });
    const second = renderHealthOmicsRatesModule({
      'eu-west-1': region({ 'omics.c.large': 0.13 }),
      'us-west-2': region({ 'omics.c.large': 0.1148, 'omics.m.large': 0.1296 }),
    });

    expect(first).toBe(second);
  });

  it('sorts regions and instance types', () => {
    const text = renderHealthOmicsRatesModule({
      'us-west-2': region({ 'omics.m.large': 0.1296, 'omics.c.large': 0.1148 }),
      'eu-west-1': region({ 'omics.c.large': 0.13 }),
    });

    expect(text.indexOf("'eu-west-1'")).toBeLessThan(text.indexOf("'us-west-2'"));
    expect(text.lastIndexOf("'omics.c.large'")).toBeLessThan(text.lastIndexOf("'omics.m.large'"));
  });

  it('says how it was generated and carries no timestamp of its own', () => {
    const text = renderHealthOmicsRatesModule({ 'us-west-2': region({ 'omics.c.large': 0.1148 }) });

    expect(text).toContain('pnpm run generate:healthomics-rates');
    expect(text.match(/\d{4}-\d{2}-\d{2}T/g)).toEqual(['2026-09-11T']);
  });

  it('wraps a source URL too long for one line the way Prettier does', () => {
    const longUrl =
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonOmics/20260911124459/us-east-1/index.json';
    const text = renderHealthOmicsRatesModule({
      'us-east-1': { ...region({ 'omics.c.large': 0.1148 }), sourceUrl: longUrl },
    });

    expect(text).toContain(`    sourceUrl:\n      '${longUrl}',`);
    expect(text.split('\n').every((line) => line.length <= 120 || line.includes(longUrl))).toBe(true);
  });

  it('exports a typed table', () => {
    const text = renderHealthOmicsRatesModule({ 'us-west-2': region({ 'omics.c.large': 0.1148 }) });

    expect(text).toContain('export const HEALTHOMICS_RATES_BY_REGION: Record<string, HealthOmicsRegionRates> = {');
    expect(text).toContain("'omics.c.large': 0.1148,");
  });
});
