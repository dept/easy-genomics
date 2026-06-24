import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
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
import { ClassificationInput } from '@BE/services/llm-classification/llm-classification-provider';
import { LLMClassificationService, ProviderConfig } from '@BE/services/llm-classification/llm-classification-service';
import { fetchRedactedLogExcerpt } from '@BE/services/llm-classification/run-log-fetcher';
import { SsmService } from '@BE/services/ssm-service';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const llmClassificationService = new LLMClassificationService();
const ssmService = new SsmService();
const cloudWatchLogsService = new CloudWatchLogsService();

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

      if (snsEvent.Type !== 'LaboratoryRun') {
        console.error(`Unsupported SNS Processing Event Type: ${snsEvent.Type}`);
        continue;
      }

      const laboratoryRun: LaboratoryRun = <LaboratoryRun>JSON.parse(JSON.stringify(snsEvent.Record));
      await processClassificationEvent(snsEvent.Operation, laboratoryRun);
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
): Promise<boolean> {
  if (operation !== 'UPDATE') {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
    return false;
  }

  const existingRun: LaboratoryRun = await laboratoryRunService.queryByRunId(laboratoryRun.RunId);

  // Idempotency: another invocation already classified this run.
  if (existingRun.FailureOwner) {
    console.log(`Run ${existingRun.RunId} already classified as ${existingRun.FailureOwner}; skipping.`);
    return true;
  }

  // Only classify runs that have actually failed and carry a failure signal.
  if (existingRun.Status?.toUpperCase() !== 'FAILED') {
    console.log(`Run ${existingRun.RunId} is not FAILED (status=${existingRun.Status}); skipping.`);
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

  const classification = await resolveClassification(existingRun, laboratory);
  if (!classification) {
    console.log(`No classification produced for run ${existingRun.RunId}; leaving fields unset.`);
    return true;
  }

  await laboratoryRunService.update({
    ...existingRun,
    FailureOwner: classification.result.owner,
    FailureSummary: classification.result.summary,
    FailureAction: classification.result.action,
    FailureClassifiedBy: classification.source,
    ModifiedAt: new Date().toISOString(),
    ModifiedBy: 'Failure Classification',
  });

  return true;
}

type ResolvedClassification = { result: ClassificationResult; source: 'lookup' | 'llm' };

async function resolveClassification(
  run: LaboratoryRun,
  laboratory: Laboratory | undefined,
): Promise<ResolvedClassification | null> {
  // Deterministic lookup first — free and high-confidence. Held (not returned
  // immediately) so it can serve as a fallback if the LLM path runs and fails.
  const lookup =
    run.Platform === 'AWS HealthOmics' && run.FailureReason ? classifyHealthOmicsFailure(run.FailureReason) : null;
  const lookupResult: ResolvedClassification | null = lookup ? { result: lookup, source: 'lookup' } : null;

  if (!laboratory) return lookupResult;

  // Setting a provider IS the enable signal for the LLM. Without one we can only
  // offer the deterministic lookup (if any).
  const platformConfig = resolvePlatformConfig(laboratory, run.Platform);
  if (!platformConfig.provider || !platformConfig.modelId) {
    return lookupResult;
  }

  // Log enrichment is opt-in per lab + platform. When off, a lookup hit wins
  // immediately (today's behaviour) and the LLM only handles lookup misses.
  const logEnrichmentEnabled = isLogEnrichmentEnabled(laboratory, run.Platform);
  if (lookupResult && !logEnrichmentEnabled) {
    return lookupResult;
  }

  const config = await buildProviderConfig(laboratory, run.Platform, platformConfig);
  if (!config) return lookupResult;

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

  const llmResult = await llmClassificationService.classify(input, config);
  // The fallback path returns owner 'Ambiguous' with empty summary/action; fall
  // back to the deterministic lookup when the model produced nothing usable.
  if (!llmResult.summary && !llmResult.action) return lookupResult;
  return { result: llmResult, source: 'llm' };
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
  platform: LaboratoryRun['Platform'],
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
      console.warn(
        `[process-classify] Lab ${laboratory.LaboratoryId} configured ${platformConfig.provider} for ${platform} but has no SSM API key; skipping.`,
      );
      return null;
    }
    return {
      provider: platformConfig.provider,
      modelId: platformConfig.modelId,
      apiKey,
    };
  } catch (err) {
    console.warn(
      `[process-classify] Failed to load ${platformConfig.ssmSuffix} for lab ${laboratory.LaboratoryId}:`,
      err,
    );
    return null;
  }
}
