export type CreateLabFormGaps = {
  hasName: boolean;
  hasBucket: boolean;
  otherErrorCount: number;
};

/**
 * The Create lab footer's message after a create attempt: what's still missing, or null when the form is complete.
 */
export function createLabFooterMessage({ hasName, hasBucket, otherErrorCount }: CreateLabFormGaps): string | null {
  const missing: string[] = [];
  if (!hasName) missing.push('a lab name');
  if (!hasBucket) missing.push('a bucket');

  if (missing.length > 0) {
    return `Add ${missing.join(' and ')} to continue.`;
  }
  if (otherErrorCount > 0) {
    return 'Fix the highlighted fields to continue.';
  }
  return null;
}
