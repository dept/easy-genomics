process.env.NAME_PREFIX = 'unit-test';

import { Laboratory, LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  RunCostEstimateFailedError,
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

const mockAddLaunchCount = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/usage-totals-service', () => ({
  UsageTotalsService: jest.fn().mockImplementation(() => ({
    addLaunchCount: (...args: unknown[]) => mockAddLaunchCount(...args),
  })),
}));

import { readSampleSheet, sumObjectBytes } from '../../../../src/app/services/easy-genomics/run-input-profile-service';
import {
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
  let errorSpy: jest.SpyInstance;
  const loggedLines = () => warnSpy.mock.calls.map(([line]) => JSON.parse(line as string));

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 96, dataFileKeys: ['a.fq.gz'] });
    mockSumObjectBytes.mockResolvedValue(5000);
    mockEstimate.mockReset().mockResolvedValue(availableEstimate(120));
    mockAddLaunchCount.mockReset().mockResolvedValue(undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new RunLimitCheckService();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const today = () => new Date().toISOString().slice(0, 10);
  const launchCount = (Kind: 'warned' | 'blocked') => ({
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    Platform: 'AWS HealthOmics',
    WorkflowExternalId: 'wf-123',
    Day: today(),
    Kind,
  });

  /** A count write that settles a macrotask later, so a caller that doesn't await it settles first. */
  const slowCountWrite = (outcome: 'resolve' | 'reject') => {
    const state = { settled: false };
    mockAddLaunchCount.mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      state.settled = true;
      if (outcome === 'reject') throw new Error('ProvisionedThroughputExceededException');
    });
    return state;
  };

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

    describe('counting the blocked launch', () => {
      const sampleBlockedLab = withLimits({ SamplesBlockAbove: 50 });

      it('adds one blocked launch and has finished the write before it throws the limit error', async () => {
        const countWrite = slowCountWrite('resolve');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, 'user-1').catch((err) => {
          expect(countWrite.settled).toBe(true);
          return err;
        });

        expect(error).toBeInstanceOf(RunSampleLimitExceededError);
        expect(mockAddLaunchCount).toHaveBeenCalledTimes(1);
        expect(mockAddLaunchCount).toHaveBeenCalledWith(launchCount('blocked'));
      });

      it('counts a launch blocked because its samples could not be counted, before rethrowing', async () => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'unreadable' });
        const countWrite = slowCountWrite('resolve');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, 'user-1').catch((err) => {
          expect(countWrite.settled).toBe(true);
          return err;
        });

        expect(error).toBeInstanceOf(RunSamplesNotCountedError);
        expect(mockAddLaunchCount).toHaveBeenCalledWith(launchCount('blocked'));
      });

      it('still throws the limit error, not the write error, when the count fails, and logs the failure', async () => {
        const countWrite = slowCountWrite('reject');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, 'user-1').catch((err) => err);

        expect(countWrite.settled).toBe(true);
        expect(error).toBeInstanceOf(RunSampleLimitExceededError);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(/RUN_LIMIT_BLOCKED.*LaboratoryId=lab-1/),
          expect.objectContaining({ message: 'ProvisionedThroughputExceededException' }),
        );
      });

      it('does not count a launch that passed or was only warned', async () => {
        mockEstimate.mockResolvedValue(availableEstimate(182.5));

        await service.assertLaunchWithinLimits(withLimits({ CostWarnAboveUsd: 150 }), input, 'user-1');
        await service.assertLaunchWithinLimits(laboratory, input, 'user-1');

        expect(mockAddLaunchCount).not.toHaveBeenCalled();
      });
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

    it('logs the warned launch with the started run id', async () => {
      await service.logWarnedLaunch(laboratory, input, 'user-1', warnVerdict, 'run-123');

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
      'logs and counts nothing for a launch that was not warned (%p)',
      async (verdict) => {
        await service.logWarnedLaunch(laboratory, input, 'user-1', verdict, 'run-123');

        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockAddLaunchCount).not.toHaveBeenCalled();
      },
    );

    it('adds one warned launch and has finished the write when it resolves', async () => {
      const countWrite = slowCountWrite('resolve');

      await service.logWarnedLaunch(laboratory, input, 'user-1', warnVerdict, 'run-123');

      expect(countWrite.settled).toBe(true);
      expect(mockAddLaunchCount).toHaveBeenCalledTimes(1);
      expect(mockAddLaunchCount).toHaveBeenCalledWith(launchCount('warned'));
    });

    it('logs a failed count without throwing, so the started launch still returns', async () => {
      const countWrite = slowCountWrite('reject');

      await expect(
        service.logWarnedLaunch(laboratory, input, 'user-1', warnVerdict, 'run-123'),
      ).resolves.toBeUndefined();

      expect(countWrite.settled).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/RUN_LIMIT_WARNED.*LaboratoryId=lab-1/),
        expect.objectContaining({ message: 'ProvisionedThroughputExceededException' }),
      );
    });
  });
});
