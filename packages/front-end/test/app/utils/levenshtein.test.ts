import { levenshtein } from '../../../src/app/utils/levenshtein';

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('e. coli', 'e. coli')).toBe(0);
  });

  it('equals the other length when one string is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts a single deletion (missing space)', () => {
    expect(levenshtein('e. coli', 'e.coli')).toBe(1);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('kitten', 'kitteZ')).toBe(1);
  });

  it('computes classic kitten -> sitting as 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});
