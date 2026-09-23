import { toSentenceCase } from '../../../src/app/utils/string-utils';

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
