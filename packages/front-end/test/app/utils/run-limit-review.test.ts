import { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import {
  RunLimitHit,
  RunLimitVerdict,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import {
  deriveRunLimitReview,
  RunLimitReviewInput,
  runLimitErrorMessage,
} from '../../../src/app/utils/run-limit-review';

const BLOCK_TITLE = "This run can't be launched";
const BLOCK_ADVICE = 'Split the samples into smaller runs, or ask an organization admin to raise the limit.';
const WARN_ADVICE = 'Check the samples and parameters before you launch.';

function estimate(overrides: Partial<EstimateRunCostResponse> = {}): EstimateRunCostResponse {
  return {
    estimateAvailable: true,
    confidence: 'MEDIUM',
    comparableRunCount: 5,
    computeCostUsd: { low: 150, median: 190, high: 240 },
    currency: 'USD',
    label: 'Estimated compute cost',
    disclaimer: 'Estimated compute cost based on similar completed runs of this workflow.',
    exclusions: ['S3', 'DATA_TRANSFER', 'RUN_STORAGE'],
    ...overrides,
  };
}

function verdict(overrides: Partial<RunLimitVerdict> = {}): RunLimitVerdict {
  return { outcome: 'pass', hits: [], costEstimate: 'available', sampleCount: 96, ...overrides };
}

function hit(limit: RunLimitHit['limit'], level: RunLimitHit['level'], amount: number, runValue: number): RunLimitHit {
  return { limit, level, amount, runValue };
}

function input(overrides: Partial<RunLimitReviewInput> = {}): RunLimitReviewInput {
  return {
    verdict: undefined,
    estimate: estimate(),
    loading: false,
    estimateFailed: false,
    serverBlockMessage: null,
    runLimits: undefined,
    ...overrides,
  };
}

describe('deriveRunLimitReview', () => {
  it('shows the Samples row and no message under limits', () => {
    const review = deriveRunLimitReview(input({ verdict: verdict(), runLimits: { SamplesBlockAbove: 500 } }));

    expect(review).toEqual({
      samplesRow: { countText: '96', limitText: 'Limit: 500 per run' },
      notEnoughHistoryText: null,
      message: null,
      launchDisabled: false,
      launchAnyway: false,
    });
  });

  it('shows a cost warning and offers Launch anyway', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({ outcome: 'warn', hits: [hit('cost', 'warn', 150, 195)] }),
        runLimits: { CostWarnAboveUsd: 150 },
      }),
    );

    expect(review).toEqual({
      samplesRow: null,
      notEnoughHistoryText: null,
      message: {
        tone: 'warn',
        role: 'status',
        title: 'Cost warning',
        body: `This run is estimated at about US$195, over this lab's US$150 warning amount. ${WARN_ADVICE}`,
      },
      launchDisabled: false,
      launchAnyway: true,
    });
  });

  it('blocks a run over the cost block amount', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({ outcome: 'block', hits: [hit('cost', 'block', 400, 470)] }),
        runLimits: { CostBlockAboveUsd: 400 },
      }),
    );

    expect(review).toEqual({
      samplesRow: null,
      notEnoughHistoryText: null,
      message: {
        tone: 'block',
        role: 'alert',
        title: BLOCK_TITLE,
        body: `It's estimated at about US$470, over this lab's US$400 limit. ${BLOCK_ADVICE}`,
      },
      launchDisabled: true,
      launchAnyway: false,
    });
  });

  it('blocks a run with too many samples', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({
          outcome: 'block',
          hits: [hit('samples', 'block', 500, 1000)],
          costEstimate: 'notEnoughHistory',
          sampleCount: 1000,
        }),
        estimate: estimate({ estimateAvailable: false, comparableRunCount: 1, computeCostUsd: undefined }),
        runLimits: { SamplesBlockAbove: 500, CostBlockAboveUsd: 400 },
      }),
    );

    expect(review).toEqual({
      samplesRow: { countText: '1,000', limitText: 'Limit: 500 per run' },
      notEnoughHistoryText: '1 past run of this workflow in this lab',
      message: {
        tone: 'block',
        role: 'alert',
        title: BLOCK_TITLE,
        body: `It has 1,000 samples, and this lab allows 500 per run. ${BLOCK_ADVICE}`,
      },
      launchDisabled: true,
      launchAnyway: false,
    });
  });

  it('says there is no estimate yet when history is short', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({ costEstimate: 'notEnoughHistory', sampleCount: 96 }),
        estimate: estimate({ estimateAvailable: false, comparableRunCount: 1, computeCostUsd: undefined }),
        runLimits: { SamplesBlockAbove: 500, CostWarnAboveUsd: 150 },
      }),
    );

    expect(review).toEqual({
      samplesRow: { countText: '96', limitText: 'Limit: 500 per run' },
      notEnoughHistoryText: '1 past run of this workflow in this lab',
      message: null,
      launchDisabled: false,
      launchAnyway: false,
    });
  });

  it('prints cents when the rounded estimate would equal the amount', () => {
    const review = deriveRunLimitReview(
      input({ verdict: verdict({ outcome: 'warn', hits: [hit('cost', 'warn', 150, 150.4)] }) }),
    );

    expect(review.message?.body).toContain("about US$150.40, over this lab's US$150 warning amount");
  });

  it('prints a fractional amount with cents', () => {
    const review = deriveRunLimitReview(
      input({ verdict: verdict({ outcome: 'warn', hits: [hit('cost', 'warn', 0.01, 3.2)] }) }),
    );

    expect(review.message?.body).toContain("about US$3, over this lab's US$0.01 warning amount");
  });

  it('shows one block message with cost then samples and the advice once', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({
          outcome: 'block',
          hits: [hit('samples', 'block', 500, 1000), hit('samples', 'warn', 300, 1000), hit('cost', 'block', 400, 470)],
          sampleCount: 1000,
        }),
      }),
    );

    expect(review.message?.body).toBe(
      `It's estimated at about US$470, over this lab's US$400 limit. It has 1,000 samples, and this lab allows 500 per run. ${BLOCK_ADVICE}`,
    );
    expect(review.launchAnyway).toBe(false);
    expect(review.launchDisabled).toBe(true);
  });

  it('titles a samples-only warning and a combined warning', () => {
    const samplesOnly = deriveRunLimitReview(
      input({ verdict: verdict({ outcome: 'warn', hits: [hit('samples', 'warn', 300, 320)], sampleCount: 320 }) }),
    );
    const both = deriveRunLimitReview(
      input({
        verdict: verdict({
          outcome: 'warn',
          hits: [hit('samples', 'warn', 300, 320), hit('cost', 'warn', 150, 195)],
          sampleCount: 320,
        }),
      }),
    );

    expect(samplesOnly.message?.title).toBe('Sample warning');
    expect(samplesOnly.message?.body).toBe(
      `This run has 320 samples, over this lab's warning amount of 300 per run. ${WARN_ADVICE}`,
    );
    expect(both.message?.title).toBe('Cost and sample warning');
    expect(both.message?.body).toBe(
      `This run is estimated at about US$195, over this lab's US$150 warning amount. This run has 320 samples, over this lab's warning amount of 300 per run. ${WARN_ADVICE}`,
    );
  });

  it('lets a server block override a warn verdict', () => {
    const serverMessage = "This run has 2 samples, above this laboratory's limit of 1. Split…";
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({ outcome: 'warn', hits: [hit('cost', 'warn', 150, 195)] }),
        serverBlockMessage: serverMessage,
      }),
    );

    expect(review.message).toEqual({ tone: 'block', role: 'alert', title: BLOCK_TITLE, body: serverMessage });
    expect(review.launchDisabled).toBe(true);
    expect(review.launchAnyway).toBe(false);
  });

  it('behaves as today with no verdict and no limits', () => {
    expect(deriveRunLimitReview(input())).toEqual({
      samplesRow: null,
      notEnoughHistoryText: null,
      message: null,
      launchDisabled: false,
      launchAnyway: false,
    });
  });

  it('shows not-checked only when the lab has limits', () => {
    const withLimits = deriveRunLimitReview(
      input({ estimate: null, estimateFailed: true, runLimits: { CostBlockAboveUsd: 400 } }),
    );
    const withoutLimits = deriveRunLimitReview(input({ estimate: null, estimateFailed: true }));

    expect(withLimits.message).toEqual({
      tone: 'warn',
      role: 'status',
      title: 'Limits not checked',
      body: "This run couldn't be checked against this lab's limits. They're checked again when you launch.",
    });
    expect(withLimits.launchDisabled).toBe(false);
    expect(withoutLimits.message).toBeNull();
  });

  it('disables launch while loading only in a lab with limits', () => {
    const withLimits = deriveRunLimitReview(
      input({ estimate: null, loading: true, runLimits: { SamplesBlockAbove: 500 } }),
    );

    expect(withLimits.launchDisabled).toBe(true);
    expect(withLimits.message).toBeNull();
    expect(withLimits.notEnoughHistoryText).toBeNull();
    expect(deriveRunLimitReview(input({ estimate: null, loading: true })).launchDisabled).toBe(false);
    expect(deriveRunLimitReview(input({ estimate: null, loading: true, runLimits: {} })).launchDisabled).toBe(false);
  });

  it('shows "Not enough runs" only for a notEnoughHistory verdict', () => {
    const noHistory = estimate({ estimateAvailable: false, comparableRunCount: 0, computeCostUsd: undefined });
    const twoRuns = estimate({ estimateAvailable: false, comparableRunCount: 2, computeCostUsd: undefined });
    const notEnoughHistory = verdict({ costEstimate: 'notEnoughHistory' });

    expect(deriveRunLimitReview(input({ verdict: notEnoughHistory, estimate: noHistory })).notEnoughHistoryText).toBe(
      'No past runs of this workflow in this lab',
    );
    expect(deriveRunLimitReview(input({ verdict: notEnoughHistory, estimate: twoRuns })).notEnoughHistoryText).toBe(
      '2 past runs of this workflow in this lab',
    );
    expect(deriveRunLimitReview(input({ estimate: twoRuns })).notEnoughHistoryText).toBeNull();
  });

  it('shows no cost row text for a sample-only lab', () => {
    const review = deriveRunLimitReview(
      input({
        verdict: verdict({ costEstimate: 'notChecked', sampleCount: 40 }),
        runLimits: { SamplesBlockAbove: 500 },
      }),
    );

    expect(review.notEnoughHistoryText).toBeNull();
    expect(review.samplesRow).toEqual({ countText: '40', limitText: 'Limit: 500 per run' });
  });

  it('hides the Samples row in a cost-only lab', () => {
    const review = deriveRunLimitReview(
      input({ verdict: verdict({ sampleCount: 0 }), runLimits: { CostWarnAboveUsd: 150 } }),
    );

    expect(review.samplesRow).toBeNull();
  });

  it('uses Warning above when only a sample warn amount is set', () => {
    const review = deriveRunLimitReview(input({ verdict: verdict(), runLimits: { SamplesWarnAbove: 300 } }));

    expect(review.samplesRow).toEqual({ countText: '96', limitText: 'Warning above 300 per run' });
  });

  it('leaves the sample count blank while the verdict loads', () => {
    const review = deriveRunLimitReview(
      input({ estimate: null, loading: true, runLimits: { SamplesBlockAbove: 500 } }),
    );

    expect(review.samplesRow).toEqual({ countText: null, limitText: 'Limit: 500 per run' });
  });
});

describe('runLimitErrorMessage', () => {
  const costOnlyNotCounted =
    "The samples in this run could not be counted, so its cost could not be checked against this laboratory's cost limit. Check the sample sheet and try again.";

  it.each([
    ['EG-339', new RunCostLimitExceededError(470, 400)],
    ['EG-340', new RunSampleLimitExceededError(2, 1)],
    ['EG-341', new RunSamplesNotCountedError()],
    ['EG-341 cost-only', new RunSamplesNotCountedError(costOnlyNotCounted)],
    ['EG-342', new RunCostEstimateFailedError()],
  ])('returns the server text for %s', (_code, serverError) => {
    expect(runLimitErrorMessage(new Error('Request error: ' + serverError.message))).toBe(serverError.message);
  });

  it('returns null for any other error', () => {
    expect(runLimitErrorMessage(new Error('Request error: Failed to submit'))).toBeNull();
    expect(runLimitErrorMessage('a string')).toBeNull();
    expect(runLimitErrorMessage(undefined)).toBeNull();
  });
});
