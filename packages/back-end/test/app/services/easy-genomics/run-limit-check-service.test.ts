process.env.NAME_PREFIX = 'unit-test';

import { Laboratory, LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';

jest.mock('../../../../src/app/services/easy-genomics/run-input-profile-service');
const mockEstimate = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/run-cost-estimation-service', () => ({
  RunCostEstimationService: jest.fn().mockImplementation(() => ({
    estimate: (...args: unknown[]) => mockEstimate(...args),
  })),
}));

import { readSampleSheet, sumObjectBytes } from '../../../../src/app/services/easy-genomics/run-input-profile-service';
import {
  effectiveRunLimits,
  evaluateRunLimits,
  hasAnyRunLimit,
  RunLimitCheckService,
  RunLimitInput,
} from '../../../../src/app/services/easy-genomics/run-limit-check-service';

const availableEstimate = (median: number) => ({
  estimateAvailable: true,
  confidence: 'MEDIUM',
  comparableRunCount: 5,
  computeCostUsd: { low: median * 0.8, median, high: median * 1.2 },
  currency: 'USD',
  label: 'Estimated compute cost',
  disclaimer: 'Approximate.',
  exclusions: [],
});

const unavailableEstimate = {
  estimateAvailable: false,
  confidence: 'NONE',
  comparableRunCount: 0,
  currency: 'USD',
  label: 'Estimate unavailable',
  disclaimer: 'Approximate.',
  exclusions: [],
};

describe('hasAnyRunLimit', () => {
  it.each([
    ['no limits object', undefined],
    ['an empty limits object', {}],
    ['a limits object with only undefined amounts', { CostWarnAboveUsd: undefined }],
  ])('is false for %s', (_label, limits) => {
    expect(hasAnyRunLimit(limits)).toBe(false);
  });

  it('is true when one amount is set', () => {
    expect(hasAnyRunLimit({ SamplesWarnAbove: 300 })).toBe(true);
  });
});

describe('evaluateRunLimits', () => {
  it('lets a run of exactly the block amount through with a warn hit', () => {
    expect(evaluateRunLimits({ SamplesWarnAbove: 300, SamplesBlockAbove: 500 }, 500, undefined, 'notChecked')).toEqual({
      outcome: 'warn',
      hits: [{ limit: 'samples', level: 'warn', amount: 300, runValue: 500 }],
      costEstimate: 'notChecked',
      sampleCount: 500,
    });
  });

  it('blocks on both limits with the sample hit first', () => {
    const verdict = evaluateRunLimits({ SamplesBlockAbove: 500, CostBlockAboveUsd: 400 }, 1000, 416.67, 'available');

    expect(verdict.outcome).toBe('block');
    expect(verdict.hits).toEqual([
      { limit: 'samples', level: 'block', amount: 500, runValue: 1000 },
      { limit: 'cost', level: 'block', amount: 400, runValue: 416.67 },
    ]);
  });

  it('applies only the sample amounts when there is not enough history', () => {
    expect(evaluateRunLimits({ SamplesWarnAbove: 300 }, 100, undefined, 'notEnoughHistory')).toEqual({
      outcome: 'pass',
      hits: [],
      costEstimate: 'notEnoughHistory',
      sampleCount: 100,
    });
  });

  it('lets a cost of exactly the block amount through', () => {
    expect(evaluateRunLimits({ CostBlockAboveUsd: 400 }, 10, 400, 'available').outcome).toBe('pass');
  });

  it('leaves out the sample count when the samples were not counted', () => {
    expect(evaluateRunLimits({ CostWarnAboveUsd: 150 }, undefined, 100, 'available')).not.toHaveProperty('sampleCount');
  });
});

describe('RunLimitCheckService', () => {
  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
  } as Laboratory;
  const withLimits = (RunLimits: LaboratoryRunLimits) => ({ ...laboratory, RunLimits }) as Laboratory;
  const settings = { input: 's3://lab-bucket/run/samplesheet.csv', outdir: 's3://lab-bucket/out' };
  const input: RunLimitInput = {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'wf-123',
    workflowVersionName: 'v1',
    sampleSheetS3Url: 's3://lab-bucket/run/samplesheet.csv',
    settings,
  };

  const mockReadSampleSheet = readSampleSheet as jest.Mock;
  const mockSumObjectBytes = sumObjectBytes as jest.Mock;
  let service: RunLimitCheckService;
  let warnSpy: jest.SpyInstance;
  const loggedLines = () => warnSpy.mock.calls.map(([line]) => JSON.parse(line as string));

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 96, dataFileKeys: ['a.fq.gz'] });
    mockSumObjectBytes.mockResolvedValue(5000);
    mockEstimate.mockReset().mockResolvedValue(availableEstimate(120));
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    service = new RunLimitCheckService();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('checkRunLimits', () => {
    it('does no reads for a lab with no limits', async () => {
      await expect(service.checkRunLimits(withLimits({}), input)).resolves.toBeUndefined();
      await expect(service.checkRunLimits(laboratory, input)).resolves.toBeUndefined();

      expect(mockReadSampleSheet).not.toHaveBeenCalled();
      expect(mockSumObjectBytes).not.toHaveBeenCalled();
      expect(mockEstimate).not.toHaveBeenCalled();
    });

    it('checks a sample-only lab without computing the estimate', async () => {
      await expect(service.checkRunLimits(withLimits({ SamplesBlockAbove: 500 }), input)).resolves.toEqual({
        outcome: 'pass',
        hits: [],
        costEstimate: 'notChecked',
        sampleCount: 96,
      });
      expect(mockReadSampleSheet).toHaveBeenCalledWith(
        expect.objectContaining({ LaboratoryId: 'lab-1' }),
        's3://lab-bucket/run/samplesheet.csv',
      );
      expect(mockEstimate).not.toHaveBeenCalled();
    });

    it('carries the counted samples in a cost-only lab', async () => {
      const verdict = await service.checkRunLimits(withLimits({ CostWarnAboveUsd: 150 }), input);

      expect(verdict).toEqual({ outcome: 'pass', hits: [], costEstimate: 'available', sampleCount: 96 });
    });

    it('carries zero samples for a header-only sheet', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 0, dataFileKeys: [] });

      const verdict = await service.checkRunLimits(withLimits({ SamplesWarnAbove: 300 }), input);

      expect(verdict?.sampleCount).toBe(0);
    });

    it('estimates from the server-read samples, rethrowing history errors, with the settings it was given', async () => {
      await service.checkRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input);

      expect(mockSumObjectBytes).toHaveBeenCalledWith('lab-bucket', ['a.fq.gz']);
      expect(mockEstimate).toHaveBeenCalledWith(
        expect.objectContaining({ LaboratoryId: 'lab-1' }),
        {
          platform: 'AWS HealthOmics',
          workflowExternalId: 'wf-123',
          workflowVersionName: 'v1',
          settings,
          sampleCount: 96,
          inputBytesTotal: 5000,
        },
        { throwOnHistoryError: true },
      );
      expect(mockEstimate.mock.calls[0][1].settings).toBe(settings);
    });

    it('compares the scaled median against the cost amounts', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(416.67));

      const verdict = await service.checkRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input);

      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'block', amount: 400, runValue: 416.67 }]);
    });

    it('reports not enough history and applies only the sample amounts', async () => {
      mockEstimate.mockResolvedValue(unavailableEstimate);
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 100, dataFileKeys: [] });

      const verdict = await service.checkRunLimits(withLimits({ SamplesWarnAbove: 300, CostBlockAboveUsd: 1 }), input);

      expect(verdict).toEqual({ outcome: 'pass', hits: [], costEstimate: 'notEnoughHistory', sampleCount: 100 });
    });

    it.each(['unreadable', 'noSampleSheet'])(
      'blocks a lab with a sample amount when the sheet was not read (%s)',
      async (reason) => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason });

        await expect(
          service.checkRunLimits(withLimits({ SamplesWarnAbove: 300, CostBlockAboveUsd: 400 }), input),
        ).rejects.toBeInstanceOf(RunSamplesNotCountedError);
        expect(mockEstimate).not.toHaveBeenCalled();
      },
    );

    // An unscaled estimate would price any size of run at the lab's usual run size, so leaving the sheet out of the
    // request must not be a way past a cost limit.
    it.each(['noSampleSheet', 'unreadable', 'notInLaboratoryBucket'])(
      'blocks a cost-only lab when the samples were not counted (%s)',
      async (reason) => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason });

        const rejection = service.checkRunLimits(withLimits({ CostWarnAboveUsd: 150 }), input);

        await expect(rejection).rejects.toBeInstanceOf(RunSamplesNotCountedError);
        await expect(rejection).rejects.toThrow(/cost limit/);
        expect(mockEstimate).not.toHaveBeenCalled();
      },
    );

    it('reports a failed estimate as a cost estimate failure', async () => {
      mockEstimate.mockRejectedValue(new Error('AccessDeniedException'));

      await expect(service.checkRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input)).rejects.toBeInstanceOf(
        RunCostEstimateFailedError,
      );
    });

    it('reports failed input sizing as a cost estimate failure', async () => {
      mockSumObjectBytes.mockRejectedValue(new Error('boom'));

      await expect(service.checkRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input)).rejects.toBeInstanceOf(
        RunCostEstimateFailedError,
      );
    });
  });

  describe('assertLaunchWithinLimits', () => {
    it('throws the sample error and logs both hits when both limits block', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 1000, dataFileKeys: [] });
      mockEstimate.mockResolvedValue(availableEstimate(416.67));
      const lab = withLimits({ SamplesBlockAbove: 500, CostBlockAboveUsd: 400 });

      const rejection = service.assertLaunchWithinLimits(lab, input, 'user-1');

      await expect(rejection).rejects.toBeInstanceOf(RunSampleLimitExceededError);
      await expect(rejection).rejects.toThrow(/1000 samples/);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedLines()[0]).toEqual({
        event: 'RUN_LIMIT_BLOCKED',
        organizationId: 'org-1',
        laboratoryId: 'lab-1',
        platform: 'AWS HealthOmics',
        workflowExternalId: 'wf-123',
        workflowVersionName: 'v1',
        userId: 'user-1',
        reason: 'limitExceeded',
        hits: [
          { limit: 'samples', level: 'block', amount: 500, runValue: 1000 },
          { limit: 'cost', level: 'block', amount: 400, runValue: 416.67 },
        ],
        sampleCount: 1000,
        costEstimateUsd: 416.67,
      });
    });

    it('logs and rethrows the same failure when the estimate fails', async () => {
      mockEstimate.mockRejectedValue(new Error('AccessDeniedException'));
      const lab = withLimits({ CostBlockAboveUsd: 400 });

      const error = await service.assertLaunchWithinLimits(lab, input, 'user-1').catch((err) => err);

      expect(error).toBeInstanceOf(RunCostEstimateFailedError);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedLines()[0]).toMatchObject({ event: 'RUN_LIMIT_BLOCKED', reason: 'costEstimateFailed', hits: [] });
    });

    it('logs samples not counted as its own reason', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'unreadable' });

      await expect(
        service.assertLaunchWithinLimits(withLimits({ SamplesBlockAbove: 500 }), input, 'user-1'),
      ).rejects.toBeInstanceOf(RunSamplesNotCountedError);
      expect(loggedLines()[0]).toMatchObject({ reason: 'samplesNotCounted', hits: [] });
    });

    it('returns a warn verdict without logging', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(182.5));

      const verdict = await service.assertLaunchWithinLimits(withLimits({ CostWarnAboveUsd: 150 }), input, 'user-1');

      expect(verdict?.outcome).toBe('warn');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('logWarnedLaunch', () => {
    const warnVerdict = {
      outcome: 'warn' as const,
      hits: [{ limit: 'cost' as const, level: 'warn' as const, amount: 150, runValue: 182.5 }],
      costEstimate: 'available' as const,
      sampleCount: 100,
    };

    it('logs the warned launch with the started run id', () => {
      service.logWarnedLaunch(laboratory, input, 'user-1', warnVerdict, 'run-123');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedLines()[0]).toEqual({
        event: 'RUN_LIMIT_WARNED',
        organizationId: 'org-1',
        laboratoryId: 'lab-1',
        platform: 'AWS HealthOmics',
        workflowExternalId: 'wf-123',
        workflowVersionName: 'v1',
        externalRunId: 'run-123',
        userId: 'user-1',
        hits: warnVerdict.hits,
        sampleCount: 100,
      });
    });

    it.each([undefined, { outcome: 'pass' as const, hits: [], costEstimate: 'notChecked' as const }])(
      'logs nothing for a launch that was not warned (%p)',
      (verdict) => {
        service.logWarnedLaunch(laboratory, input, 'user-1', verdict, 'run-123');

        expect(warnSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe('workflow cost limits', () => {
    const workflowLimits = { 'HEALTH_OMICS#5734690': { WorkflowName: 'nf-core/rnaseq', CostBlockAboveUsd: 800 } };
    const limitedLab = {
      ...laboratory,
      RunLimits: { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400 },
      WorkflowRunLimits: workflowLimits,
    } as Laboratory;
    const run: RunLimitInput = { ...input, workflowExternalId: '5734690', workflowVersionName: '3.14' };

    it("passes a US$600 run under the workflow's US$800 block amount, warning on the lab's US$150", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(600));

      const verdict = await service.checkRunLimits(limitedLab, run);

      expect(verdict?.outcome).toBe('warn');
      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'warn', amount: 150, runValue: 600 }]);
    });

    it("blocks a US$900 run on the workflow's amount and says so", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));

      const verdict = await service.checkRunLimits(limitedLab, run);
      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);

      const launch = service.assertLaunchWithinLimits(limitedLab, run, 'user-1');
      await expect(launch).rejects.toBeInstanceOf(RunCostLimitExceededError);
      await expect(launch).rejects.toThrow("this workflow's block amount of $800.00");
    });

    it("checks a lab whose only limits are the workflow's", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));
      const workflowOnlyLab = { ...laboratory, WorkflowRunLimits: workflowLimits } as Laboratory;

      const verdict = await service.checkRunLimits(workflowOnlyLab, run);

      expect(verdict?.outcome).toBe('block');
      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);
    });

    it('checks a new version against the same workflow limits', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));

      const verdict = await service.checkRunLimits(limitedLab, { ...run, workflowVersionName: '3.15' });

      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);
    });

    it('uses the SEQERA key for a Seqera launch', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));
      const seqeraLab = {
        ...limitedLab,
        WorkflowRunLimits: { 'SEQERA#42': { WorkflowName: 'nf-core/sarek', CostBlockAboveUsd: 800 } },
      } as Laboratory;

      const verdict = await service.checkRunLimits(seqeraLab, {
        ...run,
        platform: 'Seqera Cloud',
        workflowExternalId: '42',
      });

      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);
    });

    it("ignores another workflow's limits", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));
      const otherWorkflowLab = {
        ...limitedLab,
        WorkflowRunLimits: { 'HEALTH_OMICS#999': { WorkflowName: 'other', CostBlockAboveUsd: 800 } },
      } as Laboratory;

      const verdict = await service.checkRunLimits(otherWorkflowLab, run);

      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'block', amount: 400, runValue: 900 }]);
    });

    it('still makes no reads for a lab with no lab or workflow limits', async () => {
      const noLimitsLab = { ...laboratory, WorkflowRunLimits: {} } as Laboratory;

      await expect(service.checkRunLimits(noLimitsLab, run)).resolves.toBeUndefined();

      expect(mockReadSampleSheet).not.toHaveBeenCalled();
      expect(mockEstimate).not.toHaveBeenCalled();
    });
  });

  describe('effectiveRunLimits', () => {
    it("keeps the lab's sample amounts and resolves each cost amount on its own", () => {
      const lab = {
        ...laboratory,
        RunLimits: { SamplesBlockAbove: 500, CostWarnAboveUsd: 150, CostBlockAboveUsd: 400 },
        WorkflowRunLimits: { 'HEALTH_OMICS#wf-123': { WorkflowName: 'x', CostBlockAboveUsd: 800 } },
      } as Laboratory;

      expect(effectiveRunLimits(lab, input)).toEqual({
        limits: { SamplesBlockAbove: 500, CostWarnAboveUsd: 150, CostBlockAboveUsd: 800 },
        costFromWorkflow: { warn: false, block: true },
      });
    });
  });
});
