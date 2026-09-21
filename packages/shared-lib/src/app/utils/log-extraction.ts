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

interface NoiseRule {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Lines discarded before the error window is chosen.
 *
 * Nextflow on AWS HealthOmics logs a bare, headerless JVM stack frame on every
 * pf4j extension lookup — once per task — which can leave an engine log 99%
 * frames and crowd the actual cause out of the excerpt. Discarding them is safe
 * for diagnosis: Nextflow always reports the real failure in its structured
 * `Caused by:` / `Command error:` block, never in the JVM frames.
 */
const NOISE_RULES: readonly NoiseRule[] = [
  // Bare JVM frames, e.g. "\tat org.pf4j.PluginClassLoader.loadClass(PluginClassLoader.java:169)".
  { name: 'stack-frame', pattern: /^\s+at\s+[\w$.]+[\w$./]*\(.*\)\s*$/ },
  // Nextflow's periodic task status dump. Its "error: -" field also false-matches ERROR_MARKER.
  { name: 'task-status-dump', pattern: /^~>\s*TaskHandler\[/ },
  // Blank lines, which come in long runs between frame blocks.
  { name: 'blank', pattern: /^\s*$/ },
];

const isNoise = (line: string): boolean => NOISE_RULES.some((rule) => rule.pattern.test(line));

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
 *
 * Noise (see {@link NOISE_RULES}) is discarded first, so neither the anchor
 * search nor the character budget is spent on it.
 */
export function extractErrorWindow(
  logText: string | undefined | null,
  maxChars: number = DEFAULT_LOG_EXCERPT_CHARS,
): string {
  if (!logText) return '';

  const lines = logText.split('\n').filter((line) => !isNoise(line));
  const firstErrorIndex = lines.findIndex(isErrorLine);

  if (firstErrorIndex === -1) {
    return capToTail(lines.join('\n').trim(), maxChars);
  }

  const start = Math.max(0, firstErrorIndex - LEAD_IN_LINES);
  const window = lines.slice(start).join('\n').trim();
  return capToHead(window, maxChars);
}
