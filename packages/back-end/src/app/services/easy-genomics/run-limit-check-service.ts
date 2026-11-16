import { randomUUID } from 'crypto';
import {
  RunLimitHit,
  RunLimitVerdict,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import { Laboratory, LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  RunLimitBlockReason,
  RunLimitEvent,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { RunCostEstimationService } from '@BE/services/easy-genomics/run-cost-estimation-service';
import { readSampleSheet, sumObjectBytes } from '@BE/services/easy-genomics/run-input-profile-service';
import {
  RecordRunLimitEventResult,
  RunLimitEventService,
  blockedAttemptId,
} from '@BE/services/easy-genomics/run-limit-event-service';

/** A server-only description of a run. Nothing the client sends about the run's size is part of it. */
export type RunLimitInput = {
  platform: 'AWS HealthOmics' | 'Seqera Cloud';
  workflowExternalId: string;
  workflowVersionName?: string;
  sampleSheetS3Url?: string;
  /** Object or JSON string, uncoerced, so its hash matches the one the review step sends. */
  settings?: unknown;
};

type CheckedRun = { verdict: RunLimitVerdict; costEstimateUsd?: number };

/** Who a launch or review is for, as recorded on its limit events. */
export type RunLimitActor = { UserId: string; UserEmail?: string };

type RunLimitRecordSource = RunLimitEvent['Source'];

const SAMPLES_NOT_COUNTED_FOR_COST_LIMIT =
  "The samples in this run could not be counted, so its cost could not be checked against this laboratory's cost limit. Check the sample sheet and try again.";

const runCostEstimationService = new RunCostEstimationService();
const runLimitEventService = new RunLimitEventService();

export function runLimitActorOf(event: APIGatewayProxyWithCognitoAuthorizerEvent): RunLimitActor {
  const claims = event.requestContext.authorizer?.claims;
  return { UserId: claims?.UserId ?? claims?.['cognito:username'] ?? 'unknown', UserEmail: claims?.email };
}

function isAmountSet(amount?: number): boolean {
  return amount !== undefined;
}

export function hasAnyRunLimit(limits?: LaboratoryRunLimits): boolean {
  if (!limits) return false;
  return (
    isAmountSet(limits.CostWarnAboveUsd) ||
    isAmountSet(limits.CostBlockAboveUsd) ||
    isAmountSet(limits.SamplesWarnAbove) ||
    isAmountSet(limits.SamplesBlockAbove)
  );
}

function limitHit(
  limit: RunLimitHit['limit'],
  runValue: number,
  warnAbove?: number,
  blockAbove?: number,
): RunLimitHit | undefined {
  if (blockAbove !== undefined && runValue > blockAbove) {
    return { limit, level: 'block', amount: blockAbove, runValue };
  }
  if (warnAbove !== undefined && runValue > warnAbove) {
    return { limit, level: 'warn', amount: warnAbove, runValue };
  }
  return undefined;
}

/** "Above" is strict: a run value equal to an amount passes. Hits are ordered samples first, then cost. */
export function evaluateRunLimits(
  limits: LaboratoryRunLimits,
  sampleCount: number | undefined,
  costEstimateUsd: number | undefined,
  costEstimate: RunLimitVerdict['costEstimate'],
): RunLimitVerdict {
  const hits: RunLimitHit[] = [];
  if (sampleCount !== undefined) {
    const sampleHit = limitHit('samples', sampleCount, limits.SamplesWarnAbove, limits.SamplesBlockAbove);
    if (sampleHit) hits.push(sampleHit);
  }
  if (costEstimateUsd !== undefined) {
    const costHit = limitHit('cost', costEstimateUsd, limits.CostWarnAboveUsd, limits.CostBlockAboveUsd);
    if (costHit) hits.push(costHit);
  }

  let outcome: RunLimitVerdict['outcome'] = 'pass';
  if (hits.some((hit) => hit.level === 'block')) {
    outcome = 'block';
  } else if (hits.length > 0) {
    outcome = 'warn';
  }

  return { outcome, hits, costEstimate, ...(sampleCount !== undefined ? { sampleCount } : {}) };
}

function blockReasonOf(err: unknown): RunLimitBlockReason | undefined {
  if (err instanceof RunSamplesNotCountedError) return 'samplesNotCounted';
  if (err instanceof RunCostEstimateFailedError) return 'costEstimateFailed';
  return undefined;
}

export class RunLimitCheckService {
  /**
   * The review step's check. Returns undefined, with no reads, when the lab has no amounts set.
   * A block, or a limit that can't be checked (RunSamplesNotCountedError, RunCostEstimateFailedError, thrown), is
   * recorded before it reaches the client.
   */
  public async checkReviewRunLimits(
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
  ): Promise<RunLimitVerdict | undefined> {
    const checked = await this.checkAndRecordBlock(laboratory, input, actor, 'review');
    return checked?.verdict;
  }

  /** Throws the typed error on a block, after recording it. Returns the verdict, or undefined, otherwise. */
  public async assertLaunchWithinLimits(
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
  ): Promise<RunLimitVerdict | undefined> {
    const checked = await this.checkAndRecordBlock(laboratory, input, actor, 'launch');
    if (checked?.verdict.outcome !== 'block') return checked?.verdict;

    const blockHits = checked.verdict.hits.filter((hit) => hit.level === 'block');
    const sampleBlock = blockHits.find((hit) => hit.limit === 'samples');
    if (sampleBlock) throw new RunSampleLimitExceededError(sampleBlock.runValue, sampleBlock.amount);
    const costBlock = blockHits.find((hit) => hit.limit === 'cost')!;
    throw new RunCostLimitExceededError(costBlock.runValue, costBlock.amount);
  }

  /**
   * Logs and records a launch that went ahead over a warn amount, once the platform has started the run. It is
   * recorded here, from the verdict the launch was checked with, because a later request about the run can't be
   * trusted to describe it. Never throws: the run has already started.
   */
  public async logWarnedLaunch(
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
    verdict: RunLimitVerdict | undefined,
    run: { ExternalRunId?: string; RunName?: string },
  ): Promise<void> {
    if (verdict?.outcome !== 'warn') return;
    await this.recordEvent('RUN_LIMIT_WARNED', laboratory, input, actor, {
      EventId: run.ExternalRunId ?? randomUUID(),
      Kind: 'warned',
      Source: 'launch',
      Hits: verdict.hits,
      SampleCount: verdict.sampleCount,
      ExternalRunId: run.ExternalRunId,
      RunName: run.RunName,
    });
  }

  /** Records a block, whether it comes back as a verdict or is thrown because a limit couldn't be checked. */
  private async checkAndRecordBlock(
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
    source: RunLimitRecordSource,
  ): Promise<CheckedRun | undefined> {
    let checked: CheckedRun | undefined;
    try {
      checked = await this.checkRun(laboratory, input);
    } catch (err) {
      const reason = blockReasonOf(err);
      if (reason) await this.recordBlock(laboratory, input, actor, source, reason, []);
      throw err;
    }
    if (checked?.verdict.outcome === 'block') {
      const { verdict, costEstimateUsd } = checked;
      await this.recordBlock(
        laboratory,
        input,
        actor,
        source,
        'limitExceeded',
        verdict.hits,
        verdict.sampleCount,
        costEstimateUsd,
      );
    }
    return checked;
  }

  private async checkRun(laboratory: Laboratory, input: RunLimitInput): Promise<CheckedRun | undefined> {
    const limits = laboratory.RunLimits;
    if (!limits || !hasAnyRunLimit(limits)) return undefined;

    const hasSampleLimit = isAmountSet(limits.SamplesWarnAbove) || isAmountSet(limits.SamplesBlockAbove);
    const hasCostLimit = isAmountSet(limits.CostWarnAboveUsd) || isAmountSet(limits.CostBlockAboveUsd);

    const sampleSheet = await readSampleSheet(laboratory, input.sampleSheetS3Url);
    let sampleCount: number | undefined;
    let dataFileKeys: string[] = [];
    if (sampleSheet.outcome === 'read') {
      sampleCount = sampleSheet.sampleCount;
      dataFileKeys = sampleSheet.dataFileKeys;
    } else if (hasSampleLimit) {
      throw new RunSamplesNotCountedError();
    } else {
      // A cost limit needs the sample count too: an unscaled whole-run estimate would price a 1,000-sample run at its
      // 96-sample cost. That includes a run with no sample sheet, or leaving the sheet out would skip the limit.
      throw new RunSamplesNotCountedError(SAMPLES_NOT_COUNTED_FOR_COST_LIMIT);
    }

    if (!hasCostLimit) {
      return { verdict: evaluateRunLimits(limits, sampleCount, undefined, 'notChecked') };
    }

    const costEstimateUsd = await this.estimateCostUsd(laboratory, input, sampleCount!, dataFileKeys);
    const costEstimate = costEstimateUsd === undefined ? 'notEnoughHistory' : 'available';
    return { verdict: evaluateRunLimits(limits, sampleCount, costEstimateUsd, costEstimate), costEstimateUsd };
  }

  /** The scaled median, or undefined when there's not enough history. Any failure is RunCostEstimateFailedError. */
  private async estimateCostUsd(
    laboratory: Laboratory,
    input: RunLimitInput,
    sampleCount: number,
    dataFileKeys: string[],
  ): Promise<number | undefined> {
    try {
      const inputBytesTotal =
        laboratory.S3Bucket && dataFileKeys.length > 0 ? await sumObjectBytes(laboratory.S3Bucket, dataFileKeys) : 0;
      const estimate = await runCostEstimationService.estimate(
        laboratory,
        {
          platform: input.platform,
          workflowExternalId: input.workflowExternalId,
          workflowVersionName: input.workflowVersionName,
          settings: input.settings as string | Record<string, unknown> | undefined,
          sampleCount,
          inputBytesTotal,
        },
        { throwOnHistoryError: true },
      );
      return estimate.estimateAvailable ? estimate.computeCostUsd?.median : undefined;
    } catch (err) {
      console.error('Run cost estimate for the run limit check failed:', err);
      throw new RunCostEstimateFailedError();
    }
  }

  private async recordBlock(
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
    source: RunLimitRecordSource,
    reason: RunLimitBlockReason,
    hits: RunLimitHit[],
    sampleCount?: number,
    costEstimateUsd?: number,
  ): Promise<void> {
    await this.recordEvent('RUN_LIMIT_BLOCKED', laboratory, input, actor, {
      EventId: blockedAttemptId({
        laboratoryId: laboratory.LaboratoryId,
        platform: input.platform,
        workflowExternalId: input.workflowExternalId,
        userId: actor.UserId,
        sampleSheetS3Url: input.sampleSheetS3Url,
        source,
      }),
      Kind: 'blocked',
      Source: source,
      Reason: reason,
      Hits: hits,
      SampleCount: sampleCount,
      CostEstimateUsd: costEstimateUsd,
    });
  }

  /**
   * Logs the event's CloudWatch line unless it was already recorded, so a review step refreshed over the same
   * block logs it once. Never throws: a lost record must not turn a block into a pass, or fail a launch that
   * already started.
   */
  private async recordEvent(
    logEvent: 'RUN_LIMIT_WARNED' | 'RUN_LIMIT_BLOCKED',
    laboratory: Laboratory,
    input: RunLimitInput,
    actor: RunLimitActor,
    details: Pick<RunLimitEvent, 'Kind' | 'Source' | 'Hits'> &
      Partial<Pick<RunLimitEvent, 'Reason' | 'SampleCount' | 'CostEstimateUsd' | 'ExternalRunId' | 'RunName'>> & {
        EventId: string;
      },
  ): Promise<void> {
    let result: RecordRunLimitEventResult | 'failed';
    try {
      result = await runLimitEventService.record({
        OrganizationId: laboratory.OrganizationId,
        LaboratoryId: laboratory.LaboratoryId,
        Platform: input.platform,
        WorkflowExternalId: input.workflowExternalId,
        WorkflowVersionName: input.workflowVersionName,
        UserId: actor.UserId,
        UserEmail: actor.UserEmail,
        OccurredAt: new Date().toISOString(),
        ...details,
      });
    } catch (err) {
      console.error(
        `Failed to record the ${logEvent} event for OrganizationId=${laboratory.OrganizationId} ` +
          `LaboratoryId=${laboratory.LaboratoryId} WorkflowExternalId=${input.workflowExternalId} ` +
          `UserId=${actor.UserId}:`,
        err,
      );
      result = 'failed';
    }
    if (result === 'already-recorded') return;

    console.warn(
      JSON.stringify({
        event: logEvent,
        organizationId: laboratory.OrganizationId,
        laboratoryId: laboratory.LaboratoryId,
        platform: input.platform,
        workflowExternalId: input.workflowExternalId,
        workflowVersionName: input.workflowVersionName,
        source: details.Source,
        externalRunId: details.ExternalRunId,
        userId: actor.UserId,
        reason: details.Reason,
        hits: details.Hits,
        sampleCount: details.SampleCount,
        costEstimateUsd: details.CostEstimateUsd,
      }),
    );
  }
}
