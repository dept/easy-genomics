process.env.NAME_PREFIX = 'unit-test';

import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

jest.mock('../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../src/app/services/easy-genomics/run-input-profile-service');

import { LaboratoryRunService } from '../../../../src/app/services/easy-genomics/laboratory-run-service';
import { RunCostEstimationService } from '../../../../src/app/services/easy-genomics/run-cost-estimation-service';
import { buildRunInputProfile } from '../../../../src/app/services/easy-genomics/run-input-profile-service';

describe('RunCostEstimationService', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'lab-bucket',
  } as Laboratory;

  let mockQueryByWorkflowExternalId: jest.Mock;
  let svc: RunCostEstimationService;

  const mk = (overrides: Partial<LaboratoryRun> = {}): LaboratoryRun =>
    ({
      LaboratoryId: 'lab-1',
      Platform: 'Seqera Cloud',
      Status: 'COMPLETED',
      RunCostOutcome: {
        ActualComputeCostUsd: 5,
        CostSource: 'SEQERA_PROGRESS',
        CostCapturedAt: '2026-01-01',
      },
      RunInputProfile: {
        SampleCount: 2,
        InputFileCount: 1,
        InputBytesTotal: 1000,
        ParameterHash: 'abc',
      },
      TerminalAt: '2026-06-01T00:00:00Z',
      ...overrides,
    }) as LaboratoryRun;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryByWorkflowExternalId = jest.fn().mockResolvedValue([]);
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByWorkflowExternalId =
      mockQueryByWorkflowExternalId;
    (buildRunInputProfile as jest.Mock).mockResolvedValue({
      SampleCount: 2,
      InputFileCount: 1,
      InputBytesTotal: 1000,
      ParameterHash: 'abc',
    });
    svc = new RunCostEstimationService();
  });

  it('passes a bounded limit to the historical GSI query', async () => {
    await svc.estimate(lab, {
      platform: 'Seqera Cloud',
      workflowExternalId: 'wf-1',
      sampleCount: 2,
      inputBytesTotal: 1000,
      settings: { x: 1 },
    });

    expect(mockQueryByWorkflowExternalId).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({ limit: 200, sinceTerminalAt: expect.any(String) }),
    );
  });

  it('returns unavailable when GSI query fails (older stacks)', async () => {
    mockQueryByWorkflowExternalId.mockRejectedValue(new Error('Index not found'));

    const result = await svc.estimate(lab, {
      platform: 'Seqera Cloud',
      workflowExternalId: 'wf-1',
      sampleCount: 2,
      inputBytesTotal: 1000,
    });

    expect(result.estimateAvailable).toBe(false);
    expect(result.confidence).toBe('NONE');
  });

  it('filters candidates to lab/platform/success with ActualComputeCostUsd', async () => {
    mockQueryByWorkflowExternalId.mockResolvedValue([
      mk({}),
      mk({
        RunCostOutcome: { ActualComputeCostUsd: 6, CostSource: 'SEQERA_PROGRESS', CostCapturedAt: '2026-01-01' },
      }),
      mk({ LaboratoryId: 'other-lab' }),
      mk({ Platform: 'AWS HealthOmics' }),
      mk({ Status: 'FAILED' }),
      mk({
        RunCostOutcome: { CostSource: 'SEQERA_PROGRESS', CostCapturedAt: '2026-01-01' },
      }),
      mk({
        RunCostOutcome: { ActualComputeCostUsd: 7, CostSource: 'SEQERA_PROGRESS', CostCapturedAt: '2026-01-01' },
      }),
      mk({
        RunCostOutcome: { ActualComputeCostUsd: 8, CostSource: 'SEQERA_PROGRESS', CostCapturedAt: '2026-01-01' },
      }),
    ]);

    const result = await svc.estimate(lab, {
      platform: 'Seqera Cloud',
      workflowExternalId: 'wf-1',
      sampleCount: 2,
      inputBytesTotal: 1000,
      settings: {},
    });

    expect(result.estimateAvailable).toBe(true);
    expect(result.comparableRunCount).toBeGreaterThanOrEqual(3);
    expect(result.computeCostUsd).toBeDefined();
  });

  it('builds input profile when sampleCount/inputBytesTotal omitted', async () => {
    await svc.estimate(lab, {
      platform: 'Seqera Cloud',
      workflowExternalId: 'wf-1',
      inputFileKeys: ['a.fq'],
      sampleSheetS3Url: 's3://lab-bucket/sheet.csv',
      settings: '{"z":1}',
    });

    expect(buildRunInputProfile).toHaveBeenCalled();
  });

  it('toPreRunCostEstimate returns undefined when estimate unavailable', () => {
    expect(
      svc.toPreRunCostEstimate({
        estimateAvailable: false,
        confidence: 'NONE',
        comparableRunCount: 0,
        currency: 'USD',
        label: 'x',
        disclaimer: 'y',
        exclusions: [],
      }),
    ).toBeUndefined();
  });

  it('parses string settings for parameter hash without throwing', async () => {
    const result = await svc.estimate(lab, {
      platform: 'Seqera Cloud',
      workflowExternalId: 'wf-1',
      sampleCount: 1,
      inputBytesTotal: 1,
      settings: 'not-json{',
    });
    expect(result.currency).toBe('USD');
  });
});
