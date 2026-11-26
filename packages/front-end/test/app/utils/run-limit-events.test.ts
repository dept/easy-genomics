import { blockReasonLabel, formatRunLimitHit } from '../../../src/app/utils/run-limit-events';

describe('formatRunLimitHit', () => {
  it('shows the samples in the run against the limit', () => {
    expect(formatRunLimitHit({ limit: 'samples', level: 'block', amount: 2, runValue: 3 })).toBe(
      'Samples 3 (limit 2)',
    );
  });

  it('shows the estimated cost against the limit', () => {
    expect(formatRunLimitHit({ limit: 'cost', level: 'warn', amount: 10, runValue: 12.4 })).toBe(
      'Cost US$12.40 (limit US$10.00)',
    );
  });

  it('groups thousands in sample counts', () => {
    expect(formatRunLimitHit({ limit: 'samples', level: 'warn', amount: 1000, runValue: 1500 })).toBe(
      'Samples 1,500 (limit 1,000)',
    );
  });
});

describe('blockReasonLabel', () => {
  it('labels every block reason', () => {
    expect(blockReasonLabel('limitExceeded')).toBe('Over the limit');
    expect(blockReasonLabel('samplesNotCounted')).toBe("Samples couldn't be counted");
    expect(blockReasonLabel('costEstimateFailed')).toBe("Cost couldn't be estimated");
  });

  it('falls back to the limit label when a blocked event has no reason', () => {
    expect(blockReasonLabel(undefined)).toBe('Over the limit');
  });
});
