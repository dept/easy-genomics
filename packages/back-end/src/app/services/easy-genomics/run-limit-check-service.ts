import {
  RunLimitHit,
  RunLimitVerdict,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import { Laboratory, LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { RunCostEstimationService } from '@BE/services/easy-genomics/run-cost-estimation-service';
import { readSampleSheet, sumObjectBytes } from '@BE/services/easy-genomics/run-input-profile-service';

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

type BlockReason = 'limitExceeded' | 'samplesNotCounted' | 'costEstimateFailed';

const SAMPLES_NOT_COUNTED_FOR_COST_LIMIT =
  "The samples in this run could not be counted, so its cost could not be checked against this laboratory's cost limit. Check the sample sheet and try again.";

const runCostEstimationService = new RunCostEstimationService();

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

function blockReasonOf(err: unknown): BlockReason | undefined {
  if (err instanceof RunSamplesNotCountedError) return 'samplesNotCounted';
  if (err instanceof RunCostEstimateFailedError) return 'costEstimateFailed';
  return undefined;
}

export class RunLimitCheckService {
  /**
   * Returns undefined, with no reads, when the lab has no amounts set.
   * Throws RunSamplesNotCountedError or RunCostEstimateFailedError when a set limit can't be checked.
   */
  public async checkRunLimits(laboratory: Laboratory, input: RunLimitInput): Promise<RunLimitVerdict | undefined> {
    const checked = await this.checkRun(laboratory, input);
    return checked?.verdict;
  }

  /** Throws the typed error on a block, after logging it. Returns the verdict, or undefined, otherwise. */
  public async assertLaunchWithinLimits(
    laboratory: Laboratory,
    input: RunLimitInput,
    userId: string | undefined,
  ): Promise<RunLimitVerdict | undefined> {
    let checked: CheckedRun | undefined;
    try {
      checked = await this.checkRun(laboratory, input);
    } catch (err) {
      const reason = blockReasonOf(err);
      if (reason) this.logBlockedLaunch(laboratory, input, userId, reason, []);
      throw err;
    }
    if (checked?.verdict.outcome !== 'block') return checked?.verdict;

    const { verdict, costEstimateUsd } = checked;
    this.logBlockedLaunch(laboratory, input, userId, 'limitExceeded', verdict.hits, verdict.sampleCount, costEstimateUsd);

    const blockHits = verdict.hits.filter((hit) => hit.level === 'block');
    const sampleBlock = blockHits.find((hit) => hit.limit === 'samples');
    if (sampleBlock) throw new RunSampleLimitExceededError(sampleBlock.runValue, sampleBlock.amount);
    const costBlock = blockHits.find((hit) => hit.limit === 'cost')!;
    throw new RunCostLimitExceededError(costBlock.runValue, costBlock.amount);
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
    } else if (sampleSheet.reason !== 'noSampleSheet') {
      // An unscaled whole-run estimate would price a 1,000-sample run at its 96-sample cost.
      throw new RunSamplesNotCountedError(SAMPLES_NOT_COUNTED_FOR_COST_LIMIT);
    }

    if (!hasCostLimit) {
      return { verdict: evaluateRunLimits(limits, sampleCount, undefined, 'notChecked') };
    }

    const costEstimateUsd = await this.estimateCostUsd(laboratory, input, sampleCount ?? 0, dataFileKeys);
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

  private logBlockedLaunch(
    laboratory: Laboratory,
    input: RunLimitInput,
    userId: string | undefined,
    reason: BlockReason,
    hits: RunLimitHit[],
    sampleCount?: number,
    costEstimateUsd?: number,
  ): void {
    console.warn(
      JSON.stringify({
        event: 'RUN_LIMIT_BLOCKED',
        organizationId: laboratory.OrganizationId,
        laboratoryId: laboratory.LaboratoryId,
        platform: input.platform,
        workflowExternalId: input.workflowExternalId,
        workflowVersionName: input.workflowVersionName,
        userId,
        reason,
        hits,
        sampleCount,
        costEstimateUsd,
      }),
    );
  }
}
