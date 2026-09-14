import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
  SnsProcessingTrigger,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import {
  ClassificationResult,
  classifyHealthOmicsFailure,
} from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';

import { CloudWatchLogsService } from '@BE/services/cloudwatch-logs-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { logAnalysisEvent } from '@BE/services/llm-classification/analysis-logger';
import { ClassificationError, ClassificationOutcome } from '@BE/services/llm-classification/classification-outcome';
import { ClassificationInput } from '@BE/services/llm-classification/llm-classification-provider';
import { LLMClassificationService, ProviderConfig } from '@BE/services/llm-classification/llm-classification-service';
import { fetchRedactedLogExcerpt } from '@BE/services/llm-classification/run-log-fetcher';
import { SsmService } from '@BE/services/ssm-service';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const llmClassificationService = new LLMClassificationService();
const ssmService = new SsmService();
const cloudWatchLogsService = new CloudWatchLogsService();

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const snsEvent: SnsProcessingEvent = parseSqsJsonBody<SnsProcessingEvent>(sqsRecord.body);

      if (snsEvent.Type !== 'LaboratoryRun') {
        console.error(`Unsupported SNS Processing Event Type: ${snsEvent.Type}`);
        continue;
      }

      const laboratoryRun: LaboratoryRun = <LaboratoryRun>JSON.parse(JSON.stringify(snsEvent.Record));
      await processClassificationEvent(snsEvent.Operation, laboratoryRun, snsEvent.Trigger ?? 'Automatic');
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};

export async function processClassificationEvent(
  operation: SnsProcessingOperation,
  laboratoryRun: LaboratoryRun,
  trigger: SnsProcessingTrigger = 'Automatic',
): Promise<boolean> {
  const startedAt = Date.now();

  // Populated as soon as it's fetched so the catch below can report the
  // richest identifiers available at the point of failure, even when the
  // exception is thrown from further down the function.
  let existingRun: LaboratoryRun | undefined;

  try {
    if (operation !== 'UPDATE') {
      logAnalysisEvent({
        runId: laboratoryRun.RunId,
        laboratoryId: laboratoryRun.LaboratoryId,
        organizationId: laboratoryRun.OrganizationId,
        platform: laboratoryRun.Platform,
        trigger,
        outcome: 'skipped',
        reason: 'unsupported-operation',
        durationMs: Date.now() - startedAt,
      });
      return false;
    }

    const isManual = trigger === 'Manual';
    existingRun = await laboratoryRunService.queryByRunId(laboratoryRun.RunId);

    // Idempotency against duplicate status-checks. A manual trigger is an
    // explicit request to re-analyse, so it deliberately bypasses this.
    if (!isManual && existingRun.FailureOwner) {
      logAnalysisEvent({
        runId: existingRun.RunId,
        laboratoryId: existingRun.LaboratoryId,
        organizationId: existingRun.OrganizationId,
        platform: existingRun.Platform,
        trigger,
        outcome: 'skipped',
        reason: 'already-classified',
        durationMs: Date.now() - startedAt,
      });
      return true;
    }

    // Only classify runs that have actually failed and carry a failure signal.
    if (existingRun.Status?.toUpperCase() !== 'FAILED') {
      logAnalysisEvent({
        runId: existingRun.RunId,
        laboratoryId: existingRun.LaboratoryId,
        organizationId: existingRun.OrganizationId,
        platform: existingRun.Platform,
        trigger,
        outcome: 'skipped',
        reason: 'not-failed',
        durationMs: Date.now() - startedAt,
      });
      return true;
    }

    // Per-lab BYOK provider config lives on the Laboratory record. Deterministic
    // lookup still runs without needing the lab record; LLM path needs the lab's
    // provider + model + (for openai / anthropic) SSM API key.
    let laboratory: Laboratory | undefined;
    try {
      laboratory = await laboratoryService.queryByLaboratoryId(existingRun.LaboratoryId);
    } catch (err) {
      if (err instanceof LaboratoryNotFoundError) {
        console.log(`Laboratory ${existingRun.LaboratoryId} not found; falling back to deterministic lookup.`);
      } else {
        throw err;
      }
    }

    // Master switch: applies to every trigger, not just automatic ones — there
    // is no automatic path today, but this is the defense-in-depth backstop if
    // an admin disables analysis for a lab while a manual request is already
    // in flight (the request endpoint is the primary, synchronous gate).
    // `!== false` rather than `=== true` so labs that predate the field keep
    // today's behaviour with no data migration.
    if (laboratory?.FailureAnalysisEnabled === false) {
      logAnalysisEvent({
        runId: existingRun.RunId,
        laboratoryId: existingRun.LaboratoryId,
        organizationId: existingRun.OrganizationId,
        platform: existingRun.Platform,
        trigger,
        outcome: 'skipped',
        reason: 'failure-analysis-disabled',
        durationMs: Date.now() - startedAt,
      });
      return true;
    }

    // Nobody polls an automatic run, so skip the extra write on the hot path.
    if (isManual) {
      await laboratoryRunService.update({
        ...existingRun,
        AnalysisStatus: 'Running',
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'Failure Classification',
      });
    }

    const resolved = await resolveClassification(existingRun, laboratory);

    const classification = resolved.kind === 'classified' ? resolved : resolved.fallback;
    await laboratoryRunService.updateWithAttributeRemoval(
      {
        ...existingRun,
        ...(classification
          ? {
              FailureOwner: classification.result.owner,
              FailureSummary: classification.result.summary,
              FailureAction: classification.result.action,
              FailureClassifiedBy: classification.source,
            }
          : {}),
        AnalysisStatus: resolved.kind === 'failed' ? 'Failed' : 'Succeeded',
        ...(resolved.kind === 'failed'
          ? { AnalysisErrorCode: resolved.error.code, AnalysisErrorMessage: resolved.error.message }
          : {}),
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'Failure Classification',
      },
      resolved.kind === 'failed' ? [] : ['AnalysisErrorCode', 'AnalysisErrorMessage'],
    );

    const platformConfig = laboratory ? resolvePlatformConfig(laboratory, existingRun.Platform) : undefined;
    logAnalysisEvent({
      runId: existingRun.RunId,
      laboratoryId: existingRun.LaboratoryId,
      organizationId: existingRun.OrganizationId,
      platform: existingRun.Platform,
      trigger,
      outcome: resolved.kind === 'failed' ? 'failed' : 'succeeded',
      errorCode: resolved.kind === 'failed' ? resolved.error.code : undefined,
      classifiedBy: classification?.source,
      provider: platformConfig?.provider,
      modelId: platformConfig?.modelId,
      durationMs: Date.now() - startedAt,
    });

    return true;
  } catch (err) {
    logAnalysisEvent({
      runId: existingRun?.RunId ?? laboratoryRun.RunId,
      laboratoryId: existingRun?.LaboratoryId ?? laboratoryRun.LaboratoryId,
      organizationId: existingRun?.OrganizationId ?? laboratoryRun.OrganizationId,
      platform: existingRun?.Platform ?? laboratoryRun.Platform,
      trigger,
      outcome: 'failed',
      reason: 'unhandled-exception',
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

type Classified = { result: ClassificationResult; source: 'lookup' | 'llm' };

type Resolved =
  // The LLM path failed. `fallback` carries the deterministic lookup hit, if
  // there was one — a provider error must never cost the lab its free
  // classification.
  { kind: 'failed'; error: ClassificationError; fallback: Classified | null } | ({ kind: 'classified' } & Classified);

async function resolveClassification(run: LaboratoryRun, laboratory: Laboratory | undefined): Promise<Resolved> {
  // Deterministic lookup first — free and high-confidence. Held (not returned
  // immediately) so it can serve as a fallback if the LLM path runs and fails.
  const lookup =
    run.Platform === 'AWS HealthOmics' && run.FailureReason ? classifyHealthOmicsFailure(run.FailureReason) : null;
  const lookupResult: Classified | null = lookup ? { result: lookup, source: 'lookup' } : null;

  const noLlm = (): Resolved =>
    lookupResult
      ? { kind: 'classified', ...lookupResult }
      : {
          kind: 'failed',
          error: {
            code: 'CONFIG_INCOMPLETE',
            message: 'AI failure analysis is not configured for this laboratory.',
            retryable: false,
          },
          fallback: null,
        };

  if (!laboratory) return noLlm();

  // Setting a provider IS the enable signal for the LLM. Without one we can only
  // offer the deterministic lookup (if any).
  const platformConfig = resolvePlatformConfig(laboratory, run.Platform);
  if (!platformConfig.provider || !platformConfig.modelId) return noLlm();

  // Log enrichment is opt-in per lab + platform. When off, a lookup hit wins
  // immediately (today's behaviour) and the LLM only handles lookup misses.
  const logEnrichmentEnabled = isLogEnrichmentEnabled(laboratory, run.Platform);
  if (lookupResult && !logEnrichmentEnabled) {
    return { kind: 'classified', ...lookupResult };
  }

  const config = await buildProviderConfig(laboratory, platformConfig);
  if (!config) return noLlm();

  const input: ClassificationInput = {
    platform: run.Platform,
    failureReason: run.Platform === 'AWS HealthOmics' ? run.FailureReason : undefined,
    statusMessage: run.Platform === 'AWS HealthOmics' ? run.FailureStatusMessage : undefined,
    errorMessage: run.Platform === 'Seqera Cloud' ? run.FailureReason : undefined,
    errorReport: run.Platform === 'Seqera Cloud' ? run.FailureErrorReport : undefined,
    workflowName: run.WorkflowName,
  };

  // Best-effort: a missing excerpt never blocks classification.
  if (logEnrichmentEnabled) {
    input.logExcerpt = await fetchRedactedLogExcerpt(run, { cloudWatchLogsService });
  }

  const outcome: ClassificationOutcome = await llmClassificationService.classify(input, config);
  // A failed outcome (invalid model id, auth failure, provider outage, ...)
  // carries no usable classification; fall back to the deterministic lookup.
  if (outcome.outcome === 'failed') {
    return { kind: 'failed', error: outcome.error, fallback: lookupResult };
  }
  return { kind: 'classified', result: outcome.result, source: 'llm' };
}

function isLogEnrichmentEnabled(laboratory: Laboratory, platform: LaboratoryRun['Platform']): boolean {
  // Log enrichment is HealthOmics-only — its engine log lives in CloudWatch.
  // Seqera log retrieval is not implemented (uncertain log storage/retention).
  return platform === 'AWS HealthOmics' && laboratory.HealthOmicsLogEnrichmentEnabled === true;
}

type PlatformLlmConfig = {
  provider?: 'bedrock' | 'openai' | 'anthropic';
  modelId?: string;
  ssmSuffix: 'llm-api-key-healthomics' | 'llm-api-key-seqera';
};

function resolvePlatformConfig(laboratory: Laboratory, platform: LaboratoryRun['Platform']): PlatformLlmConfig {
  if (platform === 'AWS HealthOmics') {
    return {
      provider: laboratory.HealthOmicsLlmProvider,
      modelId: laboratory.HealthOmicsLlmModelId,
      ssmSuffix: 'llm-api-key-healthomics',
    };
  }
  return {
    provider: laboratory.SeqeraLlmProvider,
    modelId: laboratory.SeqeraLlmModelId,
    ssmSuffix: 'llm-api-key-seqera',
  };
}

async function buildProviderConfig(
  laboratory: Laboratory,
  platformConfig: PlatformLlmConfig,
): Promise<ProviderConfig | null> {
  if (!platformConfig.provider || !platformConfig.modelId) return null;
  if (platformConfig.provider === 'bedrock') {
    return {
      provider: 'bedrock',
      modelId: platformConfig.modelId,
      bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION,
    };
  }
  // openai / anthropic — fetch the lab + integration scoped API key from SSM.
  try {
    const param = await ssmService.getParameter({
      Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/${platformConfig.ssmSuffix}`,
      WithDecryption: true,
    });
    const apiKey = param?.Parameter?.Value;
    if (!apiKey) {
      return null;
    }
    return {
      provider: platformConfig.provider,
      modelId: platformConfig.modelId,
      apiKey,
    };
  } catch {
    return null;
  }
}
