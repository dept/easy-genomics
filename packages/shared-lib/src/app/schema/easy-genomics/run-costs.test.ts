import { RunCostsQuerySchema } from './run-costs';

const ORGANIZATION_ID = '11111111-2222-4333-8444-555555555555';

describe('RunCostsQuerySchema', () => {
  it.each([
    ['a calendar month', { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-11' }],
    ['rolling 30 days', { organizationId: ORGANIZATION_ID, period: '30d' }],
    ['rolling 60 days', { organizationId: ORGANIZATION_ID, period: '60d' }],
    ['rolling 90 days', { organizationId: ORGANIZATION_ID, period: '90d' }],
  ])('accepts %s', (_label, query) => {
    expect(RunCostsQuerySchema.safeParse(query).success).toBe(true);
  });

  it.each([
    ['a month period without a month', { organizationId: ORGANIZATION_ID, period: 'month' }],
    ['month 13', { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-13' }],
    ['month 00', { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-00' }],
    ['an unsupported rolling period', { organizationId: ORGANIZATION_ID, period: '7d' }],
    ['a missing organization', { period: '30d' }],
    ['an unknown key', { organizationId: ORGANIZATION_ID, period: '30d', laboratoryId: 'lab-1' }],
  ])('rejects %s', (_label, query) => {
    expect(RunCostsQuerySchema.safeParse(query).success).toBe(false);
  });
});
