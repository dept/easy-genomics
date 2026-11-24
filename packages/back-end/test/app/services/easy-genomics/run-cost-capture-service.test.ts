process.env.NAME_PREFIX = 'unit-test';
process.env.REGION = 'us-east-1';

import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { LaboratoryAccessTokenUnavailableError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

jest.mock('../../../../src/app/services/aws-healthomics/healthomics-rates-service');
jest.mock('../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../src/app/services/omics-lab-factory');
jest.mock('../../../../src/app/services/ssm-service');
jest.mock('../../../../src/app/utils/rest-api-utils');

import { HealthOmicsRegionRates } from '@easy-genomics/shared-lib/src/app/utils/healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from '@easy-genomics/shared-lib/src/app/utils/healthomics-rates.generated';
import { HealthOmicsRatesService } from '../../../../src/app/services/aws-healthomics/healthomics-rates-service';
import { LaboratoryService } from '../../../../src/app/services/easy-genomics/laboratory-service';
import { captureRunCostOutcome } from '../../../../src/app/services/easy-genomics/run-cost-capture-service';
import { createOmicsServiceForLab } from '../../../../src/app/services/omics-lab-factory';
import { SsmService } from '../../../../src/app/services/ssm-service';
import { getNextFlowApiQueryParameters, httpRequest } from '../../../../src/app/utils/rest-api-utils';

function mockOmicsServiceForLab(options?: { storageCapacity?: number; instanceType?: string }) {
  const start = new Date('2026-01-01T00:00:00Z');
  const stop = new Date('2026-01-01T01:00:00Z');
  (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
    listAllRunTasks: jest.fn().mockResolvedValue([
      {
        instanceType: options?.instanceType ?? 'omics.c.large',
        startTime: start,
        stopTime: stop,
        status: 'COMPLETED',
        cacheHit: false,
      },
    ]),
    getRun: jest.fn().mockResolvedValue({
      storageType: 'STATIC',
      ...(options?.storageCapacity !== undefined ? { storageCapacity: options.storageCapacity } : {}),
      startTime: start,
      stopTime: stop,
    }),
  });
}

const HEALTHOMICS_RUN = {
  Platform: 'AWS HealthOmics',
  RunId: 'run-1',
  ExternalRunId: 'omics-1',
  LaboratoryId: 'lab-1',
  OrganizationId: 'org-1',
  UserId: 'user-1',
} as LaboratoryRun;

describe('captureRunCostOutcome', () => {
  let getRates: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    getRates = jest.fn().mockResolvedValue(HEALTHOMICS_RATES_BY_REGION['us-east-1']);
    (HealthOmicsRatesService as jest.MockedClass<typeof HealthOmicsRatesService>).prototype.getRates = getRates;
    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
  });

  it('returns existing outcome when CostCapturedAt is already set', async () => {
    const existing = {
      ActualComputeCostUsd: 1.5,
      CostSource: 'SEQERA_PROGRESS' as const,
      CostCapturedAt: '2026-01-01T00:00:00Z',
    };
    const result = await captureRunCostOutcome({
      Platform: 'Seqera Cloud',
      RunCostOutcome: existing,
    } as LaboratoryRun);
    expect(result).toEqual(existing);
  });

  it('names the run when a task is on an instance type with no rate', async () => {
    mockOmicsServiceForLab({ instanceType: 'omics.z.huge' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      RunId: 'run-unpriced-1',
      ExternalRunId: 'omics-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      UserId: 'user-1',
    } as LaboratoryRun);

    expect(result?.ActualComputeCostUsd).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RunId=run-unpriced-1'));
    warn.mockRestore();
  });

  it('captures HealthOmics compute and storage costs', async () => {
    mockOmicsServiceForLab({ storageCapacity: 1200 });

    const result = await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      ExternalRunId: 'omics-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      UserId: 'user-1',
    } as LaboratoryRun);

    expect(result?.CostSource).toBe('HEALTHOMICS_TASKS');
    expect(result?.ActualComputeCostUsd).toBeGreaterThan(0);
    expect(result?.ActualStorageCostUsd).toBeGreaterThan(0);
    expect(result?.CostCapturedAt).toBeTruthy();
  });

  it("prices compute and storage with the deployment's refreshed rates", async () => {
    const refreshed: HealthOmicsRegionRates = {
      ...HEALTHOMICS_RATES_BY_REGION['us-east-1'],
      instanceHourlyUsd: { 'omics.c.large': 10 },
      runStorageGbHourUsd: { STATIC: 0.01, DYNAMIC: 0.02 },
    };
    getRates.mockResolvedValue(refreshed);
    mockOmicsServiceForLab({ storageCapacity: 1200 });

    const result = await captureRunCostOutcome(HEALTHOMICS_RUN);

    expect(getRates).toHaveBeenCalledWith('us-east-1');
    expect(result?.ActualComputeCostUsd).toBeCloseTo(10, 4);
    expect(result?.ActualStorageCostUsd).toBeCloseTo(1200 * 0.01, 4);
  });

  it('still captures a cost when the rates lookup falls back to the generated table', async () => {
    getRates.mockResolvedValue(HEALTHOMICS_RATES_BY_REGION['us-east-1']);
    mockOmicsServiceForLab({ storageCapacity: 1200 });

    const result = await captureRunCostOutcome(HEALTHOMICS_RUN);

    expect(result?.ActualComputeCostUsd).toBeCloseTo(
      HEALTHOMICS_RATES_BY_REGION['us-east-1'].instanceHourlyUsd['omics.c.large'],
      4,
    );
  });

  it('returns undefined for HealthOmics when ExternalRunId is missing', async () => {
    const result = await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
    } as LaboratoryRun);

    expect(result).toBeUndefined();
    expect(createOmicsServiceForLab).not.toHaveBeenCalled();
  });

  it('uses cost-capture as Omics userId when UserId is absent', async () => {
    mockOmicsServiceForLab({ storageCapacity: 1200 });

    await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      ExternalRunId: 'omics-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
    } as LaboratoryRun);

    expect(createOmicsServiceForLab).toHaveBeenCalledWith('lab-1', 'org-1', 'cost-capture');
  });

  it('omits ActualStorageCostUsd when storage cost cannot be calculated', async () => {
    // capacity omitted → storage calculator returns undefined
    mockOmicsServiceForLab();

    const result = await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      ExternalRunId: 'omics-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      UserId: 'user-1',
    } as LaboratoryRun);

    expect(result?.CostSource).toBe('HEALTHOMICS_TASKS');
    expect(result?.ActualComputeCostUsd).toBeGreaterThan(0);
    expect(result?.ActualStorageCostUsd).toBeUndefined();
    expect(result?.CostCapturedAt).toBeTruthy();
  });

  it('returns existing HealthOmics outcome when CostCapturedAt is set', async () => {
    const existing = {
      ActualComputeCostUsd: 2.5,
      ActualStorageCostUsd: 0.1,
      CostSource: 'HEALTHOMICS_TASKS' as const,
      CostCapturedAt: '2026-01-01T00:00:00Z',
    };
    const result = await captureRunCostOutcome({
      Platform: 'AWS HealthOmics',
      ExternalRunId: 'omics-1',
      RunCostOutcome: existing,
    } as LaboratoryRun);

    expect(result).toEqual(existing);
    expect(createOmicsServiceForLab).not.toHaveBeenCalled();
  });

  it('returns undefined for unsupported platform', async () => {
    const result = await captureRunCostOutcome({
      Platform: 'Unknown Platform' as any,
      ExternalRunId: 'x-1',
    } as LaboratoryRun);

    expect(result).toBeUndefined();
  });

  it('maps missing Seqera token to LaboratoryAccessTokenUnavailableError', async () => {
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: 'lab-1',
        OrganizationId: 'org-1',
        NextFlowTowerWorkspaceId: 'ws-1',
      });
    (SsmService as jest.MockedClass<typeof SsmService>).prototype.getParameter = jest
      .fn()
      .mockRejectedValue(new ParameterNotFound({ message: 'missing', $metadata: {} }));

    await expect(
      captureRunCostOutcome({
        Platform: 'Seqera Cloud',
        ExternalRunId: 'wf-1',
        LaboratoryId: 'lab-1',
      } as LaboratoryRun),
    ).rejects.toBeInstanceOf(LaboratoryAccessTokenUnavailableError);
  });

  it('returns undefined for non-finite Seqera cost (NaN guard)', async () => {
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: 'lab-1',
        OrganizationId: 'org-1',
        NextFlowTowerWorkspaceId: 'ws-1',
      });
    (SsmService as jest.MockedClass<typeof SsmService>).prototype.getParameter = jest.fn().mockResolvedValue({
      Parameter: { Value: 'token' },
    });
    (httpRequest as jest.Mock).mockResolvedValue({
      progress: { workflowProgress: { cost: Number.NaN } },
    });

    const result = await captureRunCostOutcome({
      Platform: 'Seqera Cloud',
      ExternalRunId: 'wf-1',
      LaboratoryId: 'lab-1',
      PlatformApiBaseUrl: 'https://tower.example.com',
    } as LaboratoryRun);

    expect(result).toBeUndefined();
  });

  it('captures Seqera progress cost when finite', async () => {
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: 'lab-1',
        OrganizationId: 'org-1',
        NextFlowTowerWorkspaceId: 'ws-1',
      });
    (SsmService as jest.MockedClass<typeof SsmService>).prototype.getParameter = jest.fn().mockResolvedValue({
      Parameter: { Value: 'token' },
    });
    (httpRequest as jest.Mock).mockResolvedValue({
      progress: { workflowProgress: { cost: 12.34567 } },
    });

    const result = await captureRunCostOutcome({
      Platform: 'Seqera Cloud',
      ExternalRunId: 'wf-1',
      LaboratoryId: 'lab-1',
      PlatformApiBaseUrl: 'https://tower.example.com',
    } as LaboratoryRun);

    expect(result?.CostSource).toBe('SEQERA_PROGRESS');
    expect(result?.ActualComputeCostUsd).toBe(12.3457);
  });
});
