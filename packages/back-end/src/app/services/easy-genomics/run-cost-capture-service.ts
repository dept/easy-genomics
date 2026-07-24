import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { LaboratoryAccessTokenUnavailableError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RunCostOutcome } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  calculateHealthOmicsComputeCostUsd,
  calculateHealthOmicsStorageCostUsd,
} from '@easy-genomics/shared-lib/src/app/utils/healthomics-cost-calculator';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { SsmService } from '@BE/services/ssm-service';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();

/**
 * Capture platform compute (and optional Omics storage) cost once a run reaches
 * a terminal state. Best-effort: callers should swallow failures so status sync
 * is never blocked by cost instrumentation.
 */
export async function captureRunCostOutcome(laboratoryRun: LaboratoryRun): Promise<RunCostOutcome | undefined> {
  if (laboratoryRun.RunCostOutcome?.CostCapturedAt) {
    return laboratoryRun.RunCostOutcome;
  }

  if (laboratoryRun.Platform === 'AWS HealthOmics') {
    return captureHealthOmicsCost(laboratoryRun);
  }
  if (laboratoryRun.Platform === 'Seqera Cloud') {
    return captureSeqeraCost(laboratoryRun);
  }
  return undefined;
}

async function captureHealthOmicsCost(laboratoryRun: LaboratoryRun): Promise<RunCostOutcome | undefined> {
  if (!laboratoryRun.ExternalRunId) return undefined;

  const omicsUserId = laboratoryRun.UserId || 'cost-capture';
  const omicsService = await createOmicsServiceForLab(
    laboratoryRun.LaboratoryId,
    laboratoryRun.OrganizationId,
    omicsUserId,
  );

  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
  const [tasks, run] = await Promise.all([
    omicsService.listAllRunTasks(laboratoryRun.ExternalRunId),
    omicsService.getRun({ id: laboratoryRun.ExternalRunId }),
  ]);

  const ActualComputeCostUsd = calculateHealthOmicsComputeCostUsd(tasks, region);
  const ActualStorageCostUsd = calculateHealthOmicsStorageCostUsd(
    {
      storageType: run.storageType,
      storageCapacity: run.storageCapacity,
      startTime: run.startTime,
      stopTime: run.stopTime,
    },
    region,
  );

  return {
    ActualComputeCostUsd,
    ...(ActualStorageCostUsd != null ? { ActualStorageCostUsd } : {}),
    CostSource: 'HEALTHOMICS_TASKS',
    CostCapturedAt: new Date().toISOString(),
  };
}

async function captureSeqeraCost(laboratoryRun: LaboratoryRun): Promise<RunCostOutcome | undefined> {
  if (!laboratoryRun.ExternalRunId) return undefined;

  const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryRun.LaboratoryId);
  const getParameterResponse: GetParameterCommandOutput | void = await ssmService
    .getParameter({
      Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
      WithDecryption: true,
    })
    .catch((error: any) => {
      if (error instanceof ParameterNotFound) {
        throw new LaboratoryAccessTokenUnavailableError();
      }
      throw error;
    });
  if (!getParameterResponse?.Parameter?.Value) {
    throw new LaboratoryAccessTokenUnavailableError();
  }

  const accessToken = getParameterResponse.Parameter.Value;
  const apiQueryParameters = getNextFlowApiQueryParameters(undefined, laboratory.NextFlowTowerWorkspaceId);
  const baseUrl = laboratoryRun.PlatformApiBaseUrl || process.env.SEQERA_API_BASE_URL;
  const progress = await httpRequest<{
    progress?: { workflowProgress?: { cost?: number } };
  }>(`${baseUrl}/workflow/${laboratoryRun.ExternalRunId}/progress?${apiQueryParameters}`, REST_API_METHOD.GET, {
    Authorization: `Bearer ${accessToken}`,
  });

  const cost = progress?.progress?.workflowProgress?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    return undefined;
  }

  return {
    ActualComputeCostUsd: Math.round(cost * 10000) / 10000,
    CostSource: 'SEQERA_PROGRESS',
    CostCapturedAt: new Date().toISOString(),
  };
}
