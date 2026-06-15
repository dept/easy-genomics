/**
 * Rejects common catastrophic-backtracking regex shapes (e.g. `(a+)+$`) before compiling.
 */
export function isFilenameRegexSafe(pattern: string): boolean {
  if (!pattern) return false;
  // Nested quantifiers on a parenthesized group: ( ... +|*|? ... ) followed by +, *, ?, or {
  if (/\([^)]*[*+?][^)]*\)[*+?{]/.test(pattern)) return false;
  try {
    // eslint-disable-next-line no-new -- validation only
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
