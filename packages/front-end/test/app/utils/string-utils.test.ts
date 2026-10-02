import { splitCommaSeparatedList, toSentenceCase } from '../../../src/app/utils/string-utils';

describe('toSentenceCase', () => {
  it('capitalises a lowercase first letter', () => {
    expect(toSentenceCase('invalid model identifier')).toBe('Invalid model identifier');
  });

  it('leaves an already-capitalised string alone', () => {
    expect(toSentenceCase('Invalid model identifier')).toBe('Invalid model identifier');
  });

  it('preserves the rest of the string, including acronyms', () => {
    expect(toSentenceCase('the ARN is malformed')).toBe('The ARN is malformed');
  });

  it('leaves a non-letter first character untouched', () => {
    expect(toSentenceCase('"quoted" value rejected')).toBe('"quoted" value rejected');
  });

  it('passes empty and undefined through unchanged', () => {
    expect(toSentenceCase('')).toBe('');
    expect(toSentenceCase(undefined)).toBeUndefined();
  });
});

describe('splitCommaSeparatedList', () => {
  it('returns an empty array for undefined', () => {
    expect(splitCommaSeparatedList(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(splitCommaSeparatedList('')).toEqual([]);
  });

  it('wraps a single value with no comma', () => {
    expect(splitCommaSeparatedList('https://app.example.com/auth/callback')).toEqual([
      'https://app.example.com/auth/callback',
    ]);
  });

  it('splits comma-separated values', () => {
    expect(splitCommaSeparatedList('https://a.example/auth/callback,https://b.example/auth/callback')).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ]);
  });

  it('trims surrounding whitespace', () => {
    expect(splitCommaSeparatedList(' https://a.example/auth/callback , https://b.example/auth/callback ')).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ]);
  });

  it('drops a trailing comma', () => {
    expect(splitCommaSeparatedList('https://a.example/auth/callback,')).toEqual(['https://a.example/auth/callback']);
  });
});
