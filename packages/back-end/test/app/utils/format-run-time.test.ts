import { formatRunTime } from '../../../src/app/utils/format-run-time';

describe('formatRunTime', () => {
  it('formats a sub-minute duration', () => {
    expect(formatRunTime(11)).toBe('0d 0h 0m 11s');
  });

  it('formats the exact duration from the demo run (911 seconds)', () => {
    expect(formatRunTime(911)).toBe('0d 0h 15m 11s');
  });

  it('formats an exact hour boundary', () => {
    expect(formatRunTime(3600)).toBe('0d 1h 0m 0s');
  });

  it('formats a multi-day duration', () => {
    expect(formatRunTime(93784)).toBe('1d 2h 3m 4s');
  });

  it('formats zero seconds', () => {
    expect(formatRunTime(0)).toBe('0d 0h 0m 0s');
  });
});
