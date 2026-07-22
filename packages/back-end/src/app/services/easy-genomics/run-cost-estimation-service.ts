import {
  EstimateRunCostRequest,
  EstimateRunCostResponse,
  PreRunCostEstimate,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  defaultCostExclusions,
  estimateComputeCostBand,
  hashRunSettings,
  HistoricalRunCostCandidate,
} from '@easy-genomics/shared-lib/src/app/utils/run-cost-estimation';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { buildRunInputProfile } from '@BE/services/easy-genomics/run-input-profile-service';
import { isTerminalLaboratoryRunStatus } from '@BE/utils/laboratory-run-ttl-utils';

const SUCCESS_STATUSES = new Set(['COMPLETED', 'SUCCEEDED']);

/**
 * Pre-run historical cost estimator. Queries DynamoDB only — never Cost Explorer.
 */
export class RunCostEstimationService {
  private readonly laboratoryRunService = new LaboratoryRunService();

  public async estimate(laboratory: Laboratory, request: EstimateRunCostRequest): Promise<EstimateRunCostResponse> {
    const exclusions = defaultCostExclusions();
    const disclaimer =
      'Estimated compute cost based on similar completed runs of this workflow. This is not an invoice. S3, data transfer, and run storage are not included.';

    let sampleCount = request.sampleCount;
    let inputBytesTotal = request.inputBytesTotal;
    let parameterHash: string;

    if (typeof request.settings === 'string') {
      try {
        parameterHash = hashRunSettings(JSON.parse(request.settings));
      } catch {
        parameterHash = hashRunSettings({});
      }
    } else {
      parameterHash = hashRunSettings(request.settings ?? {});
    }

    if (sampleCount == null || inputBytesTotal == null) {
      const profile = await buildRunInputProfile({
        laboratory,
        inputFileKeys: request.inputFileKeys,
        sampleSheetS3Url: request.sampleSheetS3Url,
        settings: request.settings,
      });
      sampleCount = sampleCount ?? profile.SampleCount;
      inputBytesTotal = inputBytesTotal ?? profile.InputBytesTotal;
      parameterHash = profile.ParameterHash;
    }

    const since = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
    let historical: LaboratoryRun[];
    try {
      historical = await this.laboratoryRunService.queryByWorkflowExternalId(request.workflowExternalId, {
        sinceTerminalAt: since,
      });
    } catch (err) {
      // GSI may not exist yet in older stacks; fall back to empty history.
      console.warn('queryByWorkflowExternalId failed (returning unavailable estimate):', err);
      historical = [];
    }

    const candidates: HistoricalRunCostCandidate[] = historical
      .filter((r) => r.Platform === request.platform)
      .filter((r) => r.LaboratoryId === laboratory.LaboratoryId)
      .filter((r) => isTerminalLaboratoryRunStatus(r.Status) && SUCCESS_STATUSES.has(r.Status.toUpperCase()))
      .filter((r) => r.RunCostOutcome?.ActualComputeCostUsd != null)
      .map((r) => ({
        ActualComputeCostUsd: r.RunCostOutcome!.ActualComputeCostUsd!,
        SampleCount: r.RunInputProfile?.SampleCount,
        InputBytesTotal: r.RunInputProfile?.InputBytesTotal,
        WorkflowVersionName: r.WorkflowVersionName,
        ParameterHash: r.RunInputProfile?.ParameterHash,
        TerminalAt: r.TerminalAt,
      }));

    const band = estimateComputeCostBand(
      {
        SampleCount: sampleCount ?? 0,
        InputBytesTotal: inputBytesTotal ?? 0,
        ParameterHash: parameterHash,
        WorkflowVersionName: request.workflowVersionName,
      },
      candidates,
    );

    if (!band.estimateAvailable || !band.computeCostUsd) {
      return {
        estimateAvailable: false,
        confidence: 'NONE',
        comparableRunCount: band.comparableRunCount,
        currency: 'USD',
        label: 'Estimated compute cost',
        disclaimer: 'Cost estimate unavailable — no run history for this workflow.',
        exclusions,
      };
    }

    return {
      estimateAvailable: true,
      confidence: band.confidence,
      comparableRunCount: band.comparableRunCount,
      computeCostUsd: band.computeCostUsd,
      currency: 'USD',
      label: 'Estimated compute cost',
      disclaimer,
      exclusions,
    };
  }

  public toPreRunCostEstimate(response: EstimateRunCostResponse): PreRunCostEstimate | undefined {
    if (!response.estimateAvailable || !response.computeCostUsd) return undefined;
    return {
      LowUsd: response.computeCostUsd.low,
      HighUsd: response.computeCostUsd.high,
      MedianUsd: response.computeCostUsd.median,
      Confidence: response.confidence,
      ComparableRunCount: response.comparableRunCount,
      EstimatedAt: new Date().toISOString(),
      Exclusions: response.exclusions,
    };
  }
}
