import { getDate, formatRelativeDateTime, getTime } from '../../../src/app/utils/date-time';

describe('getDate', () => {
  it('formats a valid ISO date as yyyy-MM-dd in local time', () => {
    const localNoon = new Date(2021, 0, 1, 12, 0, 0);
    expect(getDate(localNoon.toISOString())).toBe('2021-01-01');
  });

  it('returns null for missing input', () => {
    expect(getDate(null)).toBeNull();
    expect(getDate(undefined)).toBeNull();
    expect(getDate('')).toBeNull();
  });
});

describe('getTime', () => {
  it('formats a valid ISO date with local time and GMT offset', () => {
    expect(getTime('2021-01-01T09:38:13.000Z')).toMatch(/^\d{2}:\d{2}:\d{2} (AM|PM) GMT[+-]\d+(\.\d+)?$/);
  });

  it('returns null for missing input', () => {
    expect(getTime(null)).toBeNull();
    expect(getTime(undefined)).toBeNull();
    expect(getTime('')).toBeNull();
  });
});

describe('formatRelativeDateTime', () => {
  // Fixed local "now": Friday 7 Aug 2026, noon — avoids depending on the machine clock.
  const NOW = new Date(2026, 7, 7, 12, 0, 0);

  /** Build an ISO string from local calendar components (not UTC), so day boundaries are stable. */
  function localIso(year: number, monthIndex: number, day: number, hour = 12, minute = 0): string {
    return new Date(year, monthIndex, day, hour, minute, 0).toISOString();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null for missing input', () => {
    expect(formatRelativeDateTime(null)).toBeNull();
    expect(formatRelativeDateTime(undefined)).toBeNull();
    expect(formatRelativeDateTime('')).toBeNull();
  });

  it('returns null for an invalid date string', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(formatRelativeDateTime('not-a-date')).toBeNull();
    errorSpy.mockRestore();
  });

  describe('today / yesterday (local calendar day, not 24h window)', () => {
    it('returns the time for today at early morning and late evening', () => {
      const early = localIso(2026, 7, 7, 0, 15);
      const late = localIso(2026, 7, 7, 23, 45);
      expect(formatRelativeDateTime(early)).toBe(getTime(early));
      expect(formatRelativeDateTime(late)).toBe(getTime(late));
    });

    it('returns "Yesterday" for late evening yesterday and early morning yesterday', () => {
      expect(formatRelativeDateTime(localIso(2026, 7, 6, 23, 45))).toBe('Yesterday');
      expect(formatRelativeDateTime(localIso(2026, 7, 6, 0, 15))).toBe('Yesterday');
    });

    it('classifies by local calendar day after UTC serialization round-trip', () => {
      // toISOString() is UTC; classification must still use the local calendar day.
      const yesterdayLateLocal = new Date(2026, 7, 6, 23, 0, 0);
      expect(formatRelativeDateTime(yesterdayLateLocal.toISOString())).toBe('Yesterday');
    });
  });

  describe('days ago (2–30 inclusive)', () => {
    it('returns "2 days ago" at the lower bound, regardless of time of day', () => {
      expect(formatRelativeDateTime(localIso(2026, 7, 5, 0, 0))).toBe('2 days ago');
      expect(formatRelativeDateTime(localIso(2026, 7, 5, 23, 59))).toBe('2 days ago');
    });

    it('returns "30 days ago" at the upper bound (prefers days over months)', () => {
      // Jul 8 is both 30 calendar days and 1 calendar month before Aug 7 — days bucket wins.
      expect(formatRelativeDateTime(localIso(2026, 6, 8))).toBe('30 days ago');
    });

    it('crosses a month boundary while still in the days bucket', () => {
      expect(formatRelativeDateTime(localIso(2026, 6, 20))).toBe('18 days ago');
    });
  });

  describe('months ago (1–12 inclusive)', () => {
    it('switches to months once past 30 calendar days', () => {
      // Jul 7 is 31 days and 1 calendar month before Aug 7.
      expect(formatRelativeDateTime(localIso(2026, 6, 7))).toBe('1 month ago');
    });

    it('returns "12 months ago" at the upper bound (prefers months over years)', () => {
      // Exactly one year earlier is 12 months and 1 calendar year — months bucket wins.
      expect(formatRelativeDateTime(localIso(2025, 7, 7))).toBe('12 months ago');
    });

    it('handles end-of-month month arithmetic', () => {
      jest.setSystemTime(new Date(2026, 2, 31, 12, 0, 0)); // Mar 31
      expect(formatRelativeDateTime(localIso(2026, 0, 31))).toBe('2 months ago'); // Jan 31
      expect(formatRelativeDateTime(localIso(2026, 1, 28))).toBe('1 month ago'); // Feb 28
    });
  });

  describe('years ago (older than 12 months)', () => {
    it('returns "1 year ago" just past the 12-month boundary', () => {
      expect(formatRelativeDateTime(localIso(2025, 6, 7))).toBe('1 year ago'); // 13 months
    });

    it('returns plural years for multi-year-old timestamps', () => {
      expect(formatRelativeDateTime(localIso(2020, 7, 7))).toBe('6 years ago');
    });

    it('handles a leap-day source date', () => {
      expect(formatRelativeDateTime(localIso(2024, 1, 29))).toBe('2 years ago');
    });
  });

  describe('calendar / year-boundary edges', () => {
    it('returns "Yesterday" across New Year (Jan 1 ← Dec 31)', () => {
      jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      expect(formatRelativeDateTime(localIso(2025, 11, 31, 23, 30))).toBe('Yesterday');
    });

    it('returns an absolute date for future timestamps (does not say years ago)', () => {
      const tomorrow = localIso(2026, 7, 8);
      expect(formatRelativeDateTime(tomorrow)).toBe(getDate(tomorrow));
      expect(formatRelativeDateTime(tomorrow)).not.toMatch(/ago$/);
    });
  });
});
