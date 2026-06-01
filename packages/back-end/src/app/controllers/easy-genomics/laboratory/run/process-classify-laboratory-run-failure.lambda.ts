import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
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

import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { ClassificationInput } from '@BE/services/llm-classification/llm-classification-provider';
import { LLMClassificationService, ProviderConfig } from '@BE/services/llm-classification/llm-classification-service';
import { SsmService } from '@BE/services/ssm-service';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const llmClassificationService = new LLMClassificationService();
const ssmService = new SsmService();

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
  const laboratory: Laboratory | undefined = await laboratoryService.queryByLaboratoryId(existingRun.LaboratoryId);

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
  // Deterministic lookup first — runs regardless of per-lab toggles because it
  // is free and high-confidence.
  if (run.Platform === 'AWS HealthOmics' && run.FailureReason) {
    const lookup = classifyHealthOmicsFailure(run.FailureReason);
    if (lookup) {
      return { result: lookup, source: 'lookup' };
    }
  }

  if (!laboratory) return null;

  // Setting a provider IS the enable signal — no separate toggle. If the lab
  // hasn't configured a provider + model for this integration, skip the LLM.
  const platformConfig = resolvePlatformConfig(laboratory, run.Platform);
  if (!platformConfig.provider || !platformConfig.modelId) {
    return null;
  }

  const config = await buildProviderConfig(laboratory, run.Platform, platformConfig);
  if (!config) return null;

  const input: ClassificationInput = {
    platform: run.Platform,
    failureReason: run.Platform === 'AWS HealthOmics' ? run.FailureReason : undefined,
    statusMessage: run.Platform === 'AWS HealthOmics' ? run.FailureReason : undefined,
    errorMessage: run.Platform === 'Seqera Cloud' ? run.FailureReason : undefined,
    workflowName: run.WorkflowName,
  };

  const llmResult = await llmClassificationService.classify(input, config);
  // The fallback path returns owner 'Ambiguous' with empty summary/action; only
  // persist when the model produced usable text.
  if (!llmResult.summary && !llmResult.action) return null;
  return { result: llmResult, source: 'llm' };
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
