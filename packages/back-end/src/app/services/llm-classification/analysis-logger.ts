import { AnalysisEvidence } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';

import { ClassificationErrorCode, LlmProviderName } from './classification-outcome';

export interface AnalysisLogFields {
  runId: string;
  laboratoryId: string;
  organizationId: string;
  platform: 'AWS HealthOmics' | 'Seqera Cloud';
  trigger: 'Automatic' | 'Manual';
  outcome: 'succeeded' | 'failed' | 'skipped';
  durationMs: number;
  provider?: LlmProviderName;
  modelId?: string;
  errorCode?: ClassificationErrorCode;
  classifiedBy?: 'lookup' | 'llm';
  /** What the LLM was given to reason about. Absent on the deterministic lookup path. */
  evidence?: AnalysisEvidence;
  /** Why the run was skipped, e.g. 'automatic-analysis-disabled'. */
  reason?: string;
}

/**
 * The single structured-log emitter for failure analysis. One line of JSON per
 * execution so CloudWatch Logs Insights can aggregate across runs.
 *
 * Deliberately carries no log excerpt, no failure text, and no API key — only
 * fields that are safe to retain and useful to query.
 */
export function logAnalysisEvent(fields: AnalysisLogFields): void {
  const payload: Record<string, unknown> = { event: 'failure-analysis' };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  console.log(JSON.stringify(payload));
}
