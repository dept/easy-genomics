import { toCountBucket, toDurationBucket, toSizeBucket } from './analytics-buckets';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('toCountBucket', () => {
  it('buckets zero, negative and non-finite inputs as "0"', () => {
    expect(toCountBucket(0)).toBe('0');
    expect(toCountBucket(-1)).toBe('0');
    expect(toCountBucket(NaN)).toBe('0');
    expect(toCountBucket(Infinity)).toBe('0');
    expect(toCountBucket(-Infinity)).toBe('0');
  });

  it('buckets values at and around each boundary edge', () => {
    expect(toCountBucket(1)).toBe('1');
    expect(toCountBucket(2)).toBe('2-5');
    expect(toCountBucket(5)).toBe('2-5');
    expect(toCountBucket(6)).toBe('6-20');
    expect(toCountBucket(20)).toBe('6-20');
    expect(toCountBucket(21)).toBe('21-100');
    expect(toCountBucket(100)).toBe('21-100');
    expect(toCountBucket(101)).toBe('100+');
    expect(toCountBucket(1_000_000)).toBe('100+');
  });
});

describe('toSizeBucket', () => {
  it('buckets zero, negative and non-finite inputs as "0"', () => {
    expect(toSizeBucket(0)).toBe('0');
    expect(toSizeBucket(-1)).toBe('0');
    expect(toSizeBucket(NaN)).toBe('0');
    expect(toSizeBucket(Infinity)).toBe('0');
  });

  it('buckets values at and around each boundary edge', () => {
    expect(toSizeBucket(1)).toBe('<10MB');
    expect(toSizeBucket(10 * MB - 1)).toBe('<10MB');
    expect(toSizeBucket(10 * MB)).toBe('10MB-100MB');
    expect(toSizeBucket(100 * MB - 1)).toBe('10MB-100MB');
    expect(toSizeBucket(100 * MB)).toBe('100MB-1GB');
    expect(toSizeBucket(GB - 1)).toBe('100MB-1GB');
    expect(toSizeBucket(GB)).toBe('1GB-10GB');
    expect(toSizeBucket(10 * GB - 1)).toBe('1GB-10GB');
    expect(toSizeBucket(10 * GB)).toBe('10GB+');
    expect(toSizeBucket(1024 * GB)).toBe('10GB+');
  });
});

describe('toDurationBucket', () => {
  it('buckets sub-minute, negative and non-finite inputs as "<1m"', () => {
    expect(toDurationBucket(0)).toBe('<1m');
    expect(toDurationBucket(59)).toBe('<1m');
    expect(toDurationBucket(-1)).toBe('<1m');
    expect(toDurationBucket(NaN)).toBe('<1m');
    // Infinity is non-finite, so the guard maps it to the smallest bucket.
    expect(toDurationBucket(Infinity)).toBe('<1m');
  });

  it('buckets values at and around each boundary edge (seconds)', () => {
    expect(toDurationBucket(60)).toBe('1-5m');
    expect(toDurationBucket(5 * 60 - 1)).toBe('1-5m');
    expect(toDurationBucket(5 * 60)).toBe('5-30m');
    expect(toDurationBucket(30 * 60 - 1)).toBe('5-30m');
    expect(toDurationBucket(30 * 60)).toBe('30m-2h');
    expect(toDurationBucket(120 * 60 - 1)).toBe('30m-2h');
    expect(toDurationBucket(120 * 60)).toBe('2-12h');
    expect(toDurationBucket(720 * 60 - 1)).toBe('2-12h');
    expect(toDurationBucket(720 * 60)).toBe('12h+');
  });
});
