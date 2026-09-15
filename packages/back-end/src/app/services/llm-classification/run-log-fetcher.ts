import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { extractErrorWindow } from '@easy-genomics/shared-lib/src/app/utils/log-extraction';
import { redactSensitive } from '@easy-genomics/shared-lib/src/app/utils/log-redaction';

import { CloudWatchLogsService } from '@BE/services/cloudwatch-logs-service';

/** CloudWatch log group HealthOmics writes every run's engine + task logs to. */
const HEALTHOMICS_LOG_GROUP = '/aws/omics/WorkflowLog';

export interface RunLogFetcherDeps {
  cloudWatchLogsService: CloudWatchLogsService;
}

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
 * error) is logged and resolved to `undefined` so the caller can classify
 * without the excerpt rather than failing the whole pipeline.
 */
export async function fetchRedactedLogExcerpt(
  run: LaboratoryRun,
  deps: RunLogFetcherDeps,
): Promise<string | undefined> {
  if (run.Platform !== 'AWS HealthOmics' || !run.ExternalRunId) return undefined;

  try {
    // HealthOmics names the engine stream deterministically per run.
    const logStreamName = `run/${run.ExternalRunId}/engine`;
    const rawLog = await deps.cloudWatchLogsService.getLogStreamText(HEALTHOMICS_LOG_GROUP, logStreamName);
    if (!rawLog) return undefined;

    const excerpt = redactSensitive(extractErrorWindow(rawLog));
    return excerpt || undefined;
  } catch (error) {
    console.warn(`[run-log-fetcher] Could not fetch logs for run ${run.RunId}:`, error);
    return undefined;
  }
}
