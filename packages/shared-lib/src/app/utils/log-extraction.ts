/**
 * Extracts the diagnostically relevant slice of a run log.
 *
 * Engine / task logs are mostly provisioning and progress noise; the actionable
 * failure is a handful of lines near the first error marker (or, when no marker
 * is present, at the very end of the log). Sending the whole log wastes tokens
 * and can blow the model context window, so we narrow to an error window and cap
 * its size before redaction + LLM submission.
 */

/** Default character cap for the returned excerpt. Matches the LLM prompt's field cap. */
export const DEFAULT_LOG_EXCERPT_CHARS = 4000;

/** Lines of preceding context kept before the first error marker. */
const LEAD_IN_LINES = 3;

/**
 * Markers that indicate the start of a failure. Kept deliberately specific so we
 * don't anchor on benign lines (e.g. "0 failed"). Matched case-insensitively.
 */
const ERROR_MARKER =
  /\b(error|fatal|exception|traceback|caused by|exit status|command error|terminated with an error|out of memory|oom|killed|no such file|permission denied|cannot |unable to|not found)\b/i;

const isErrorLine = (line: string): boolean => ERROR_MARKER.test(line);

const capToTail = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `…[truncated]\n${text.slice(text.length - maxChars)}`;

const capToHead = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…[truncated]`;

/**
 * Return the error window of a log as plain text, bounded to `maxChars`.
 *
 * - If an error marker is found, the window runs from a few lines before the
 *   first marker to the end of the log, head-truncated (the failure onset is the
 *   most useful part).
 * - If no marker is found, the tail of the log is returned (failures usually
 *   surface at the end), tail-truncated.
 * - Empty / nullish input returns an empty string.
 */
export function extractErrorWindow(
  logText: string | undefined | null,
  maxChars: number = DEFAULT_LOG_EXCERPT_CHARS,
): string {
  if (!logText) return '';

  const lines = logText.split('\n');
  const firstErrorIndex = lines.findIndex(isErrorLine);

  if (firstErrorIndex === -1) {
    return capToTail(logText.trim(), maxChars);
  }

  const start = Math.max(0, firstErrorIndex - LEAD_IN_LINES);
  const window = lines.slice(start).join('\n').trim();
  return capToHead(window, maxChars);
}
