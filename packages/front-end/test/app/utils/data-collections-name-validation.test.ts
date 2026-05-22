import {
  DATA_COLLECTION_BATCH_NAME_MAX_LENGTH,
  DATA_COLLECTION_TAG_NAME_MAX_LENGTH,
  exceedsBatchNameMaxLength,
  exceedsMaxLength,
  exceedsTagNameMaxLength,
} from '../../../src/app/utils/data-collections-name-validation';

describe('exceedsMaxLength', () => {
  it('returns false for empty or whitespace-only values', () => {
    expect(exceedsMaxLength('', 40)).toBe(false);
    expect(exceedsMaxLength('   ', 40)).toBe(false);
  });

  it('returns false when trimmed length is exactly at the limit', () => {
    const atLimit = 'a'.repeat(40);
    expect(exceedsMaxLength(atLimit, 40)).toBe(false);
    expect(exceedsMaxLength(`  ${atLimit}  `, 40)).toBe(false);
  });

  it('returns true when trimmed length exceeds the limit', () => {
    expect(exceedsMaxLength('a'.repeat(41), 40)).toBe(true);
    expect(exceedsMaxLength(`  ${'a'.repeat(41)}  `, 40)).toBe(true);
  });
});

describe('exceedsTagNameMaxLength', () => {
  it('uses the 40-character tag limit', () => {
    expect(exceedsTagNameMaxLength('a'.repeat(DATA_COLLECTION_TAG_NAME_MAX_LENGTH))).toBe(false);
    expect(exceedsTagNameMaxLength('a'.repeat(DATA_COLLECTION_TAG_NAME_MAX_LENGTH + 1))).toBe(true);
  });
});

describe('exceedsBatchNameMaxLength', () => {
  it('uses the 250-character batch limit', () => {
    expect(exceedsBatchNameMaxLength('a'.repeat(DATA_COLLECTION_BATCH_NAME_MAX_LENGTH))).toBe(false);
    expect(exceedsBatchNameMaxLength('a'.repeat(DATA_COLLECTION_BATCH_NAME_MAX_LENGTH + 1))).toBe(true);
  });
});
