import { RunLimitEventsQuerySchema } from './run-limit-events';

const ORGANIZATION_ID = '11111111-2222-4333-8444-555555555555';

describe('RunLimitEventsQuerySchema', () => {
  it('accepts a month or rolling period with a kind', () => {
    const month = { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-11', kind: 'blocked' };
    const rolling = { organizationId: ORGANIZATION_ID, period: '30d', kind: 'warned' };

    expect(RunLimitEventsQuerySchema.safeParse(month).success).toBe(true);
    expect(RunLimitEventsQuerySchema.safeParse(rolling).success).toBe(true);
  });

  it('rejects a missing or unknown kind', () => {
    expect(RunLimitEventsQuerySchema.safeParse({ organizationId: ORGANIZATION_ID, period: '30d' }).success).toBe(false);
    expect(
      RunLimitEventsQuerySchema.safeParse({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'passed' }).success,
    ).toBe(false);
  });

  it('rejects month on a rolling period', () => {
    const query = { organizationId: ORGANIZATION_ID, period: '30d', month: '2026-11', kind: 'blocked' };

    expect(RunLimitEventsQuerySchema.safeParse(query).success).toBe(false);
  });
});
