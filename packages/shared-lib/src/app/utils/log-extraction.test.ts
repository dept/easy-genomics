import { DEFAULT_LOG_EXCERPT_CHARS, extractErrorWindow } from './log-extraction';

describe('extractErrorWindow', () => {
  it('returns an empty string for empty / nullish input', () => {
    expect(extractErrorWindow('')).toBe('');
    expect(extractErrorWindow(undefined)).toBe('');
    expect(extractErrorWindow(null)).toBe('');
  });

  it('starts a few lines before the first error marker', () => {
    const log = [
      'line 0 noise',
      'line 1 noise',
      'line 2 noise',
      'line 3 noise',
      'line 4 noise',
      'line 5 Caused by: boom',
      'line 6 detail',
    ].join('\n');
    const out = extractErrorWindow(log);
    // LEAD_IN is 3 lines before index 5 -> starts at line 2.
    expect(out).toContain('line 2 noise');
    expect(out).toContain('Caused by: boom');
    expect(out).toContain('line 6 detail');
    expect(out).not.toContain('line 0 noise');
  });

  it('falls back to the tail when there is no error marker', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `progress step ${i}`);
    const out = extractErrorWindow(lines.join('\n'), 60);
    expect(out).toContain('progress step 49');
    expect(out).not.toContain('progress step 0');
  });

  it('head-truncates an oversized error window', () => {
    const big = 'ERROR start\n' + 'x'.repeat(10_000);
    const out = extractErrorWindow(big, 100);
    expect(out.length).toBeLessThanOrEqual(100 + '\n…[truncated]'.length);
    expect(out).toContain('ERROR start');
    expect(out).toContain('…[truncated]');
  });

  it('detects common engine/nextflow failure markers', () => {
    for (const marker of [
      'java.lang.OutOfMemoryError',
      'exit status 1',
      'Command error:',
      'No such file or directory',
      'Permission denied',
    ]) {
      const out = extractErrorWindow(`noise\nnoise\n${marker}\ntrailing`);
      expect(out).toContain(marker);
    }
  });

  it('defaults the cap to DEFAULT_LOG_EXCERPT_CHARS', () => {
    expect(DEFAULT_LOG_EXCERPT_CHARS).toBe(4000);
  });
});
