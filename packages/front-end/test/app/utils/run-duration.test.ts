import { formatRunDuration } from '../../../src/app/utils/run-duration';

describe('formatRunDuration', () => {
  it('returns null when no duration was recorded', () => {
    expect(formatRunDuration(undefined)).toBeNull();
    expect(formatRunDuration(null)).toBeNull();
  });

  it('returns null for values that cannot be a duration', () => {
    expect(formatRunDuration(-1)).toBeNull();
    expect(formatRunDuration(Number.NaN)).toBeNull();
    expect(formatRunDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('shows seconds alone under a minute', () => {
    expect(formatRunDuration(0)).toBe('0s');
    expect(formatRunDuration(45)).toBe('45s');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatRunDuration(387)).toBe('6m 27s');
    expect(formatRunDuration(61)).toBe('1m 1s');
  });

  it('omits a zero seconds part', () => {
    expect(formatRunDuration(120)).toBe('2m');
  });

  it('shows hours and minutes at an hour or more, dropping seconds', () => {
    expect(formatRunDuration(3900)).toBe('1h 5m');
    expect(formatRunDuration(3959)).toBe('1h 5m');
  });

  it('omits a zero minutes part', () => {
    expect(formatRunDuration(7200)).toBe('2h');
  });

  it('rounds fractional seconds rather than rendering them', () => {
    expect(formatRunDuration(45.6)).toBe('46s');
  });
});
