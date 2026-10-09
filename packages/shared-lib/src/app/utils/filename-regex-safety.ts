const MAX_FILENAME_REGEX_LENGTH = 256;

// Escapes and character classes are blanked so a literal `(` or `*` inside them is not read as syntax.
const ESCAPE_OR_CHARACTER_CLASS = /\\.|\[(?:\\.|[^\]\\])*\]/g;
// `(?:`, `(?<name>`, `(?=`, `(?!`, `(?<=`, `(?<!` open a group; their `?` is not a quantifier.
const GROUP_OPENER = /\(\?(?::|=|!|<=|<!|<[A-Za-z_][A-Za-z0-9_]*>)/g;

// `?` after a group repeats it at most once, so only `*`, `+` and `{` make a group dangerous.
const QUANTIFIED_GROUP_CONTAINING_QUANTIFIER = /\([^)]*[*+?][^)]*\)[*+{]/;
const QUANTIFIED_GROUP_CONTAINING_ALTERNATION = /\([^)]*\|[^)]*\)[*+{]/;

/**
 * Rejects common catastrophic-backtracking regex shapes (e.g. `(a+)+$`, `(a|a)*$`) before compiling.
 * Heuristic, not a proof: patterns run only against S3 key basenames, and the length cap bounds the rest.
 */
export function isFilenameRegexSafe(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_FILENAME_REGEX_LENGTH) return false;
  const structure = pattern
    .replace(ESCAPE_OR_CHARACTER_CLASS, (match) => (match.startsWith('\\') ? 'e' : 'c'))
    .replace(GROUP_OPENER, '(');
  if (QUANTIFIED_GROUP_CONTAINING_QUANTIFIER.test(structure)) return false;
  if (QUANTIFIED_GROUP_CONTAINING_ALTERNATION.test(structure)) return false;
  try {
    // eslint-disable-next-line no-new -- validation only
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
