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

const mockRecord = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/run-limit-event-service', () => ({
  ...jest.requireActual('../../../../src/app/services/easy-genomics/run-limit-event-service'),
  RunLimitEventService: jest.fn().mockImplementation(() => ({
    record: (...args: unknown[]) => mockRecord(...args),
  })),
}));

import { readSampleSheet, sumObjectBytes } from '../../../../src/app/services/easy-genomics/run-input-profile-service';
import {
  effectiveRunLimits,
  evaluateRunLimits,
  hasAnyRunLimit,
  RunLimitActor,
  RunLimitCheckService,
  RunLimitInput,
  runLimitActorOf,
} from '../../../../src/app/services/easy-genomics/run-limit-check-service';
import { blockedAttemptId } from '../../../../src/app/services/easy-genomics/run-limit-event-service';

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
    mockRecord.mockReset().mockResolvedValue('recorded');
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new RunLimitCheckService();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const actor: RunLimitActor = { UserId: 'user-1', UserEmail: 'user@example.com' };
  const expectedEvent = (Kind: 'warned' | 'blocked') => ({
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    Platform: 'AWS HealthOmics',
    WorkflowExternalId: 'wf-123',
    WorkflowVersionName: 'v1',
    UserId: 'user-1',
    UserEmail: 'user@example.com',
    Kind,
    OccurredAt: expect.any(String),
  });

  /** A count write that settles a macrotask later, so a caller that doesn't await it settles first. */
  const slowCountWrite = (outcome: 'resolve' | 'reject') => {
    const state = { settled: false };
    mockRecord.mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      state.settled = true;
      if (outcome === 'reject') throw new Error('ProvisionedThroughputExceededException');
    });
    return state;
  };

  describe('checkReviewRunLimits', () => {
    it('does no reads for a lab with no limits', async () => {
      await expect(service.checkReviewRunLimits(withLimits({}), input, actor)).resolves.toBeUndefined();
      await expect(service.checkReviewRunLimits(laboratory, input, actor)).resolves.toBeUndefined();

      expect(mockReadSampleSheet).not.toHaveBeenCalled();
      expect(mockSumObjectBytes).not.toHaveBeenCalled();
      expect(mockEstimate).not.toHaveBeenCalled();
    });

    it('checks a sample-only lab without computing the estimate', async () => {
      await expect(service.checkReviewRunLimits(withLimits({ SamplesBlockAbove: 500 }), input, actor)).resolves.toEqual({
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
      const verdict = await service.checkReviewRunLimits(withLimits({ CostWarnAboveUsd: 150 }), input, actor);

      expect(verdict).toEqual({ outcome: 'pass', hits: [], costEstimate: 'available', sampleCount: 96 });
    });

    it('carries zero samples for a header-only sheet', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 0, dataFileKeys: [] });

      const verdict = await service.checkReviewRunLimits(withLimits({ SamplesWarnAbove: 300 }), input, actor);

      expect(verdict?.sampleCount).toBe(0);
    });

    it('estimates from the server-read samples, rethrowing history errors, with the settings it was given', async () => {
      await service.checkReviewRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input, actor);

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

      const verdict = await service.checkReviewRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input, actor);

      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'block', amount: 400, runValue: 416.67 }]);
    });

    it('reports not enough history and applies only the sample amounts', async () => {
      mockEstimate.mockResolvedValue(unavailableEstimate);
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 100, dataFileKeys: [] });

      const verdict = await service.checkReviewRunLimits(withLimits({ SamplesWarnAbove: 300, CostBlockAboveUsd: 1 }), input, actor);

      expect(verdict).toEqual({ outcome: 'pass', hits: [], costEstimate: 'notEnoughHistory', sampleCount: 100 });
    });

    it.each(['unreadable', 'noSampleSheet'])(
      'blocks a lab with a sample amount when the sheet was not read (%s)',
      async (reason) => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason });

        await expect(
          service.checkReviewRunLimits(withLimits({ SamplesWarnAbove: 300, CostBlockAboveUsd: 400 }), input, actor),
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

        const rejection = service.checkReviewRunLimits(withLimits({ CostWarnAboveUsd: 150 }), input, actor);

        await expect(rejection).rejects.toBeInstanceOf(RunSamplesNotCountedError);
        await expect(rejection).rejects.toThrow(/cost limit/);
        expect(mockEstimate).not.toHaveBeenCalled();
      },
    );

    it('reports a failed estimate as a cost estimate failure', async () => {
      mockEstimate.mockRejectedValue(new Error('AccessDeniedException'));

      await expect(service.checkReviewRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input, actor)).rejects.toBeInstanceOf(
        RunCostEstimateFailedError,
      );
    });

    it('reports failed input sizing as a cost estimate failure', async () => {
      mockSumObjectBytes.mockRejectedValue(new Error('boom'));

      await expect(service.checkReviewRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input, actor)).rejects.toBeInstanceOf(
        RunCostEstimateFailedError,
      );
    });


    describe('recording a blocked review', () => {
      const sampleBlockedLab = withLimits({ SamplesBlockAbove: 50 });

      it('records a review-step block once and returns the verdict', async () => {
        const verdict = await service.checkReviewRunLimits(sampleBlockedLab, input, actor);

        expect(verdict?.outcome).toBe('block');
        expect(mockRecord).toHaveBeenCalledTimes(1);
        expect(mockRecord).toHaveBeenCalledWith({
          ...expectedEvent('blocked'),
          EventId: blockedAttemptId({
            laboratoryId: 'lab-1',
            platform: 'AWS HealthOmics',
            workflowExternalId: 'wf-123',
            userId: 'user-1',
            sampleSheetS3Url: 's3://lab-bucket/run/samplesheet.csv',
            source: 'review',
          }),
          Source: 'review',
          Reason: 'limitExceeded',
          Hits: [{ limit: 'samples', level: 'block', amount: 50, runValue: 96 }],
          SampleCount: 96,
        });
      });

      it('gives the same event id on every refresh of the same review', async () => {
        await service.checkReviewRunLimits(sampleBlockedLab, input, actor);
        await service.checkReviewRunLimits(sampleBlockedLab, input, actor);

        expect(mockRecord.mock.calls[1][0].EventId).toBe(mockRecord.mock.calls[0][0].EventId);
      });

      it('records a review-step samplesNotCounted error with its reason and rethrows it unchanged', async () => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'unreadable' });

        const error = await service.checkReviewRunLimits(sampleBlockedLab, input, actor).catch((err) => err);

        expect(error).toBeInstanceOf(RunSamplesNotCountedError);
        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({ Source: 'review', Reason: 'samplesNotCounted', Hits: [] }),
        );
      });

      it('records a review-step cost estimate failure with its reason and rethrows it unchanged', async () => {
        mockEstimate.mockRejectedValue(new Error('AccessDeniedException'));

        const error = await service
          .checkReviewRunLimits(withLimits({ CostBlockAboveUsd: 400 }), input, actor)
          .catch((err) => err);

        expect(error).toBeInstanceOf(RunCostEstimateFailedError);
        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({ Source: 'review', Reason: 'costEstimateFailed' }),
        );
      });

      it('records a block with no sample sheet under a stable event id', async () => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'noSampleSheet' });
        const sheetless = { ...input, sampleSheetS3Url: undefined };

        await service.checkReviewRunLimits(sampleBlockedLab, sheetless, actor).catch(() => undefined);

        expect(mockRecord.mock.calls[0][0].EventId).toBe(
          blockedAttemptId({
            laboratoryId: 'lab-1',
            platform: 'AWS HealthOmics',
            workflowExternalId: 'wf-123',
            userId: 'user-1',
            source: 'review',
          }),
        );
      });

      it('logs a review-step block with its source, and only the first time it is recorded', async () => {
        await service.checkReviewRunLimits(sampleBlockedLab, input, actor);
        mockRecord.mockResolvedValue('already-recorded');
        await service.checkReviewRunLimits(sampleBlockedLab, input, actor);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(loggedLines()[0]).toMatchObject({ event: 'RUN_LIMIT_BLOCKED', source: 'review' });
      });

      it('records a launch block after a review block of the same run as a separate event', async () => {
        await service.checkReviewRunLimits(sampleBlockedLab, input, actor);
        await service.assertLaunchWithinLimits(sampleBlockedLab, input, actor).catch(() => undefined);

        expect(mockRecord.mock.calls[1][0].EventId).not.toBe(mockRecord.mock.calls[0][0].EventId);
        expect(mockRecord.mock.calls[1][0].Source).toBe('launch');
      });

      it('records nothing for a pass or warn on the review step', async () => {
        mockEstimate.mockResolvedValue(availableEstimate(182.5));

        await service.checkReviewRunLimits(withLimits({ CostWarnAboveUsd: 150 }), input, actor);
        await service.checkReviewRunLimits(withLimits({ SamplesBlockAbove: 500 }), input, actor);
        await service.checkReviewRunLimits(laboratory, input, actor);

        expect(mockRecord).not.toHaveBeenCalled();
      });

      it('still returns the verdict when recording fails', async () => {
        slowCountWrite('reject');

        await expect(service.checkReviewRunLimits(sampleBlockedLab, input, actor)).resolves.toMatchObject({
          outcome: 'block',
        });
      });
    });
  });

  describe('runLimitActorOf', () => {
    const eventWithClaims = (claims: Record<string, string>) => ({ requestContext: { authorizer: { claims } } }) as any;

    it('prefers UserId, then the Cognito username, then unknown, and carries the email', () => {
      expect(runLimitActorOf(eventWithClaims({ 'UserId': 'u1', 'cognito:username': 'c1', 'email': 'a@b.c' }))).toEqual({
        UserId: 'u1',
        UserEmail: 'a@b.c',
      });
      expect(runLimitActorOf(eventWithClaims({ 'cognito:username': 'c1' }))).toEqual({
        UserId: 'c1',
        UserEmail: undefined,
      });
      expect(runLimitActorOf(eventWithClaims({})).UserId).toBe('unknown');
    });
  });

  describe('assertLaunchWithinLimits', () => {
    it('throws the sample error and logs both hits when both limits block', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'read', sampleCount: 1000, dataFileKeys: [] });
      mockEstimate.mockResolvedValue(availableEstimate(416.67));
      const lab = withLimits({ SamplesBlockAbove: 500, CostBlockAboveUsd: 400 });

      const rejection = service.assertLaunchWithinLimits(lab, input, actor);

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
        source: 'launch',
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

      const error = await service.assertLaunchWithinLimits(lab, input, actor).catch((err) => err);

      expect(error).toBeInstanceOf(RunCostEstimateFailedError);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedLines()[0]).toMatchObject({ event: 'RUN_LIMIT_BLOCKED', reason: 'costEstimateFailed', hits: [] });
    });

    it('logs samples not counted as its own reason', async () => {
      mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'unreadable' });

      await expect(
        service.assertLaunchWithinLimits(withLimits({ SamplesBlockAbove: 500 }), input, actor),
      ).rejects.toBeInstanceOf(RunSamplesNotCountedError);
      expect(loggedLines()[0]).toMatchObject({ reason: 'samplesNotCounted', hits: [] });
    });

    describe('counting the blocked launch', () => {
      const sampleBlockedLab = withLimits({ SamplesBlockAbove: 50 });

      it('records one blocked launch and has finished the write before it throws the limit error', async () => {
        const countWrite = slowCountWrite('resolve');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, actor).catch((err) => {
          expect(countWrite.settled).toBe(true);
          return err;
        });

        expect(error).toBeInstanceOf(RunSampleLimitExceededError);
        expect(mockRecord).toHaveBeenCalledTimes(1);
        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({ ...expectedEvent('blocked'), Source: 'launch', Reason: 'limitExceeded' }),
        );
      });

      it('records a launch blocked because its samples could not be counted, before rethrowing', async () => {
        mockReadSampleSheet.mockResolvedValue({ outcome: 'notRead', reason: 'unreadable' });
        const countWrite = slowCountWrite('resolve');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, actor).catch((err) => {
          expect(countWrite.settled).toBe(true);
          return err;
        });

        expect(error).toBeInstanceOf(RunSamplesNotCountedError);
        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({ ...expectedEvent('blocked'), Source: 'launch', Reason: 'samplesNotCounted' }),
        );
      });

      it('still throws the limit error, not the write error, when recording fails, and logs the failure', async () => {
        const countWrite = slowCountWrite('reject');

        const error = await service.assertLaunchWithinLimits(sampleBlockedLab, input, actor).catch((err) => err);

        expect(countWrite.settled).toBe(true);
        expect(error).toBeInstanceOf(RunSampleLimitExceededError);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(/RUN_LIMIT_BLOCKED.*LaboratoryId=lab-1/),
          expect.objectContaining({ message: 'ProvisionedThroughputExceededException' }),
        );
      });

      it('does not record a launch that passed or was only warned', async () => {
        mockEstimate.mockResolvedValue(availableEstimate(182.5));

        await service.assertLaunchWithinLimits(withLimits({ CostWarnAboveUsd: 150 }), input, actor);
        await service.assertLaunchWithinLimits(laboratory, input, actor);

        expect(mockRecord).not.toHaveBeenCalled();
      });
    });

    it('returns a warn verdict without logging', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(182.5));

      const verdict = await service.assertLaunchWithinLimits(withLimits({ CostWarnAboveUsd: 150 }), input, actor);

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
      await service.logWarnedLaunch(laboratory, input, actor, warnVerdict, { ExternalRunId: 'run-123', RunName: 'my run' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedLines()[0]).toEqual({
        event: 'RUN_LIMIT_WARNED',
        organizationId: 'org-1',
        laboratoryId: 'lab-1',
        platform: 'AWS HealthOmics',
        workflowExternalId: 'wf-123',
        workflowVersionName: 'v1',
        source: 'launch',
        externalRunId: 'run-123',
        userId: 'user-1',
        hits: warnVerdict.hits,
        sampleCount: 100,
      });
    });

    it.each([undefined, { outcome: 'pass' as const, hits: [], costEstimate: 'notChecked' as const }])(
      'logs and records nothing for a launch that was not warned (%p)',
      async (verdict) => {
        await service.logWarnedLaunch(laboratory, input, actor, verdict, { ExternalRunId: 'run-123', RunName: 'my run' });

        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockRecord).not.toHaveBeenCalled();
      },
    );

    it('records one warned launch and has finished the write when it resolves', async () => {
      const countWrite = slowCountWrite('resolve');

      await service.logWarnedLaunch(laboratory, input, actor, warnVerdict, { ExternalRunId: 'run-123', RunName: 'my run' });

      expect(countWrite.settled).toBe(true);
      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          ...expectedEvent('warned'),
          EventId: 'run-123',
          ExternalRunId: 'run-123',
          RunName: 'my run',
          Source: 'launch',
        }),
      );
    });

    it('logs a failed recording without throwing, so the started launch still returns', async () => {
      const countWrite = slowCountWrite('reject');

      await expect(
        service.logWarnedLaunch(laboratory, input, actor, warnVerdict, { ExternalRunId: 'run-123', RunName: 'my run' }),
      ).resolves.toBeUndefined();

      expect(countWrite.settled).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/RUN_LIMIT_WARNED.*LaboratoryId=lab-1/),
        expect.objectContaining({ message: 'ProvisionedThroughputExceededException' }),
      );
    });
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

      const verdict = await service.checkReviewRunLimits(limitedLab, run, actor);

      expect(verdict?.outcome).toBe('warn');
      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'warn', amount: 150, runValue: 600 }]);
    });

    it("blocks a US$900 run on the workflow's amount and says so", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));

      const verdict = await service.checkReviewRunLimits(limitedLab, run, actor);
      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);

      const launch = service.assertLaunchWithinLimits(limitedLab, run, actor);
      await expect(launch).rejects.toBeInstanceOf(RunCostLimitExceededError);
      await expect(launch).rejects.toThrow("this workflow's block amount of $800.00");
    });

    it("checks a lab whose only limits are the workflow's", async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));
      const workflowOnlyLab = { ...laboratory, WorkflowRunLimits: workflowLimits } as Laboratory;

      const verdict = await service.checkReviewRunLimits(workflowOnlyLab, run, actor);

      expect(verdict?.outcome).toBe('block');
      expect(verdict?.hits).toEqual([
        { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' },
      ]);
    });

    it('checks a new version against the same workflow limits', async () => {
      mockEstimate.mockResolvedValue(availableEstimate(900));

      const verdict = await service.checkReviewRunLimits(limitedLab, { ...run, workflowVersionName: '3.15' }, actor);

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

      const verdict = await service.checkReviewRunLimits(
        seqeraLab,
        { ...run, platform: 'Seqera Cloud', workflowExternalId: '42' },
        actor,
      );

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

      const verdict = await service.checkReviewRunLimits(otherWorkflowLab, run, actor);

      expect(verdict?.hits).toEqual([{ limit: 'cost', level: 'block', amount: 400, runValue: 900 }]);
    });

    it('still makes no reads for a lab with no lab or workflow limits', async () => {
      const noLimitsLab = { ...laboratory, WorkflowRunLimits: {} } as Laboratory;

      await expect(service.checkReviewRunLimits(noLimitsLab, run, actor)).resolves.toBeUndefined();

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
