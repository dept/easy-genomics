/**
 * Explains why an AI failure-analysis verdict rests on thin evidence.
 *
 * An `Ambiguous` owner reads as a non-answer on its own. These messages name
 * what the classifier was actually given, so the user can tell a verdict about
 * the run apart from a gap in the platform's own inputs — and, where there is
 * one, act on it.
 *
 * `log-excerpt` has no message by design: the model saw a real log excerpt and
 * still could not decide, which is an honest verdict needing no excuse.
 */
const MESSAGES: Record<string, string> = {
  'enrichment-disabled':
    'The analyser only saw the run status code — the engine log was not included. Turn on HealthOmics log enrichment in Lab Settings and run the analysis again.',
  'log-unavailable':
    'The engine log for this run could not be read from CloudWatch. It may have expired, or the run may have failed before the engine wrote anything.',
  'log-no-error':
    'The engine log was read but contains no error detail — the workflow engine exited without reporting a cause. Check the task logs in CloudWatch.',
};

export function analysisEvidenceMessage(evidence: string | undefined): string | undefined {
  return evidence ? MESSAGES[evidence] : undefined;
}
