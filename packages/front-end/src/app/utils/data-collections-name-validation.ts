import {
  DATA_COLLECTION_BATCH_NAME_MAX_LENGTH,
  DATA_COLLECTION_TAG_NAME_MAX_LENGTH,
} from '@easy-genomics/shared-lib/src/app/constants/data-collections';

export { DATA_COLLECTION_BATCH_NAME_MAX_LENGTH, DATA_COLLECTION_TAG_NAME_MAX_LENGTH };

/** True when value has non-whitespace content and trimmed length exceeds max. */
export function exceedsMaxLength(value: string, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length > max;
}

export function exceedsTagNameMaxLength(value: string): boolean {
  return exceedsMaxLength(value, DATA_COLLECTION_TAG_NAME_MAX_LENGTH);
}

export function exceedsBatchNameMaxLength(value: string): boolean {
  return exceedsMaxLength(value, DATA_COLLECTION_BATCH_NAME_MAX_LENGTH);
}
