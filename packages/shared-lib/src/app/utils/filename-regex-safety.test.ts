import { isFilenameRegexSafe } from './filename-regex-safety';

// Copied from REGEX_GROUPING_PRESETS on fix/egv-322-sample-grouping-folder-key (PR #964),
// plus the four patterns that existed before it.
const GROUPING_PRESET_PATTERNS = [
  '(?<sample>.+?)[._-](?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  '(?<sample>.+?)_(?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?',
  '(?<sample>.+?)-(?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?',
  '(?<sample>.+?)_(?<read>[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?',
  '(?<sample>.+?)-(?<read>[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?',
  '(?<sample>.+?)_(?<read>R[12])(?:_001)?\\.fastq\\.gz',
  '(?<sample>.+?)-(?<read>R[12])(?:_001)?\\.fastq\\.gz',
  '(?<sample>.+?)_(?<read>[12])(?:_001)?\\.fastq\\.gz',
  '(?<sample>.+?)-(?<read>[12])(?:_001)?\\.fastq\\.gz',
];

const OTHER_SAFE_PATTERNS = [
  '(?:_001)?',
  '(?<sample>.+?)_R1.*\\.fastq\\.gz',
  '^(\\d+)-sample\\.fq$',
  '[(]+\\.txt',
  '\\(a+\\)+',
];

const CATASTROPHIC_PATTERNS = ['(a+)+$', '(a|a)*$', '^(a|aa)+$', '(.*a){20}', '(\\w+\\s?)*$', '(a*)*b', '(?:a|b)+c'];

describe('isFilenameRegexSafe', () => {
  it.each([...GROUPING_PRESET_PATTERNS, ...OTHER_SAFE_PATTERNS])('accepts %s', (pattern) => {
    expect(isFilenameRegexSafe(pattern)).toBe(true);
  });

  it.each(CATASTROPHIC_PATTERNS)('rejects %s', (pattern) => {
    expect(isFilenameRegexSafe(pattern)).toBe(false);
  });

  it('rejects an empty pattern, an invalid pattern and one over 256 characters', () => {
    expect(isFilenameRegexSafe('')).toBe(false);
    expect(isFilenameRegexSafe('(?<sample>[')).toBe(false);
    expect(isFilenameRegexSafe('a'.repeat(257))).toBe(false);
  });
});
