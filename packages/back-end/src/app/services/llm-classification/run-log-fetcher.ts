import { AnalysisEvidence } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { extractErrorWindow, hasErrorMarker } from '@easy-genomics/shared-lib/src/app/utils/log-extraction';
import { redactSensitive } from '@easy-genomics/shared-lib/src/app/utils/log-redaction';

import { CloudWatchLogsService } from '@BE/services/cloudwatch-logs-service';

/** CloudWatch log group HealthOmics writes every run's engine + task logs to. */
const HEALTHOMICS_LOG_GROUP = '/aws/omics/WorkflowLog';

/**
 * Log events to pull from the tail of the engine stream.
 *
 * Deliberately larger than the service default: Nextflow on HealthOmics emits a
 * stack frame per task, so most of a window is noise and a root cause logged a
 * few hundred events before the failure would otherwise never be fetched.
 */
const ENGINE_LOG_EVENT_LIMIT = 1000;

export interface RunLogFetcherDeps {
  cloudWatchLogsService: CloudWatchLogsService;
}

/**
 * The excerpt plus why it is what it is. `reason` is stored on the run so the
 * UI can tell an `Ambiguous` verdict reached on real evidence apart from one
 * reached on none — the caller previously saw only `string | undefined` and
 * could not distinguish "no log" from "log with nothing in it".
 */
export interface RunLogExcerpt {
  excerpt?: string;
  reason: Exclude<AnalysisEvidence, 'enrichment-disabled'>;
}

const UNAVAILABLE: RunLogExcerpt = { reason: 'log-unavailable' };

/**
 * Fetch the failed HealthOmics run's engine log, narrow it to the error window,
 * and redact all PII + secrets — returning a bounded excerpt safe to send to an
 * external LLM.
 *
 * Only AWS HealthOmics is supported: its logs live in CloudWatch in the platform
 * account. Seqera log retrieval is intentionally NOT implemented — Seqera's log
 * storage/retention is not well understood yet, so we don't risk it.
 *
 * Best-effort by contract: any failure (missing stream, no permission, network
 * error) is logged and resolved to an excerpt-less {@link RunLogExcerpt} so the
 * caller can classify without it rather than failing the whole pipeline.
 */
export async function fetchRedactedLogExcerpt(run: LaboratoryRun, deps: RunLogFetcherDeps): Promise<RunLogExcerpt> {
  if (run.Platform !== 'AWS HealthOmics' || !run.ExternalRunId) return UNAVAILABLE;

  try {
    // HealthOmics names the engine stream deterministically per run.
    const logStreamName = `run/${run.ExternalRunId}/engine`;
    const rawLog = await deps.cloudWatchLogsService.getLogStreamText(
      HEALTHOMICS_LOG_GROUP,
      logStreamName,
      ENGINE_LOG_EVENT_LIMIT,
    );
    if (!rawLog) return UNAVAILABLE;

    const excerpt = redactSensitive(extractErrorWindow(rawLog));
    if (!excerpt) return UNAVAILABLE;

    // Still sent to the model — the tail of a log is weak evidence, not no
    // evidence — but recorded as such so the UI can say why a verdict is thin.
    return { excerpt, reason: hasErrorMarker(rawLog) ? 'log-excerpt' : 'log-no-error' };
  } catch (error) {
    console.warn(`[run-log-fetcher] Could not fetch logs for run ${run.RunId}:`, error);
    return UNAVAILABLE;
  }
}
