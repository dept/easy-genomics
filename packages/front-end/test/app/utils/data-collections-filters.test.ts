import type { LaboratoryRunUsageSummary } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { isExpiringSoon, soonestExpiresAtForUsages } from '../../../src/app/utils/data-collections-filters';

const NOW = 1_777_000_000;
const DAY = 86_400;

function usage(runId: string, expiresAt?: number): LaboratoryRunUsageSummary {
  return {
    RunId: runId,
    RunName: `Run ${runId}`,
    ExpiresAt: expiresAt,
  } as LaboratoryRunUsageSummary;
}

describe('soonestExpiresAtForUsages', () => {
  it('returns undefined when usages is undefined or empty', () => {
    expect(soonestExpiresAtForUsages(undefined)).toBeUndefined();
    expect(soonestExpiresAtForUsages([])).toBeUndefined();
  });

  it('returns undefined when no usages carry an ExpiresAt (non-expiring lab)', () => {
    expect(soonestExpiresAtForUsages([usage('r1'), usage('r2')])).toBeUndefined();
  });

  it('returns the minimum ExpiresAt across mixed usages', () => {
    const result = soonestExpiresAtForUsages([
      usage('r1', NOW + 90 * DAY),
      usage('r2'),
      usage('r3', NOW + 10 * DAY),
      usage('r4', NOW + 45 * DAY),
    ]);
    expect(result).toBe(NOW + 10 * DAY);
  });
});

describe('isExpiringSoon', () => {
  it('always returns false for Permanent-tagged files even when very near expiry', () => {
    expect(
      isExpiringSoon({
        isPermanent: true,
        usages: [usage('r1', NOW + 1)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns false when there are no recorded run usages', () => {
    expect(isExpiringSoon({ isPermanent: false, usages: undefined, thresholdDays: 30, nowEpoch: NOW })).toBe(false);
    expect(isExpiringSoon({ isPermanent: false, usages: [], thresholdDays: 30, nowEpoch: NOW })).toBe(false);
  });

  it('returns false when usages exist but none carry an ExpiresAt (non-expiring runs)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1'), usage('r2')],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns true when soonest ExpiresAt is within the threshold window', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 60 * DAY), usage('r2', NOW + 20 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });

  it('returns false when the soonest ExpiresAt is beyond the threshold window', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 60 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns true when ExpiresAt is already in the past (overdue but not yet swept)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW - 5 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });

  it('treats the threshold as inclusive (soonest - now === thresholdDays * 86400)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 30 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });
});
