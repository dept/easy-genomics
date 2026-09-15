import { formatRunStatusPhrase } from '../../../src/app/utils/format-run-status-phrase';

describe('formatRunStatusPhrase', () => {
  it('formats COMPLETED as a success phrase', () => {
    expect(formatRunStatusPhrase('COMPLETED')).toBe('completed successfully');
  });

  it('formats SUCCEEDED as a success phrase', () => {
    expect(formatRunStatusPhrase('SUCCEEDED')).toBe('completed successfully');
  });

  it('formats FAILED as a failure phrase', () => {
    expect(formatRunStatusPhrase('FAILED')).toBe('failed');
  });

  it('formats CANCELLED as a cancellation phrase', () => {
    expect(formatRunStatusPhrase('CANCELLED')).toBe('was cancelled');
  });

  it('formats ABORTED as an abort phrase', () => {
    expect(formatRunStatusPhrase('ABORTED')).toBe('was aborted');
  });

  it('formats DELETED as a deletion phrase', () => {
    expect(formatRunStatusPhrase('DELETED')).toBe('was deleted');
  });

  it('is case-insensitive', () => {
    expect(formatRunStatusPhrase('completed')).toBe('completed successfully');
    expect(formatRunStatusPhrase('Failed')).toBe('failed');
  });

  it('falls back to a generic phrase for an unrecognized status', () => {
    expect(formatRunStatusPhrase('RUNNING')).toBe('is RUNNING');
  });
});
