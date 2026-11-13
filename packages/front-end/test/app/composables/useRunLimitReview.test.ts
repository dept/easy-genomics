import type {
  EstimateRunCostRequest,
  EstimateRunCostResponse,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import {
  RunCostEstimateFailedError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
// vue is provided by Nuxt, not declared in this package's package.json
// eslint-disable-next-line import/no-extraneous-dependencies
import { computed, ref } from 'vue';

import { useRunLimitReview } from '../../../src/app/composables/useRunLimitReview';

const LAB_ID = 'lab-1';

const mockEstimateRunCost = jest.fn();
const mockToastError = jest.fn();
const mockLoadLab = jest.fn();
let labs: Record<string, { RunLimits?: Record<string, number> }> = {};

// useRunLimitReview relies on Nuxt auto-imports (no explicit import).
(global as any).ref = ref;
(global as any).computed = computed;
(global as any).useNuxtApp = () => ({ $api: { labs: { estimateRunCost: mockEstimateRunCost } } });
(global as any).useLabsStore = () => ({ labs, loadLab: mockLoadLab });
(global as any).useToastStore = () => ({ error: mockToastError });

const availableEstimate: EstimateRunCostResponse = {
  estimateAvailable: true,
  confidence: 'MEDIUM',
  comparableRunCount: 5,
  computeCostUsd: { low: 150, median: 190, high: 240 },
  currency: 'USD',
  label: 'Estimated compute cost',
  disclaimer: 'Estimated compute cost based on similar completed runs of this workflow.',
  exclusions: ['S3', 'DATA_TRANSFER', 'RUN_STORAGE'],
};

const request: EstimateRunCostRequest = { platform: 'AWS HealthOmics', workflowExternalId: 'wf-1' };

function requestError(message: string): Error {
  return new Error('Request error: ' + message);
}

describe('useRunLimitReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    labs = { [LAB_ID]: {} };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('passes the response verdict to the review', async () => {
    const response: EstimateRunCostResponse = {
      ...availableEstimate,
      limitVerdict: {
        outcome: 'warn',
        hits: [{ limit: 'cost', level: 'warn', amount: 150, runValue: 195 }],
        costEstimate: 'available',
        sampleCount: 2,
      },
    };
    mockEstimateRunCost.mockResolvedValue(response);
    labs[LAB_ID].RunLimits = { CostWarnAboveUsd: 150 };
    const { review, costEstimate, costEstimateLoading, loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    await loadEstimate();

    expect(review.value.launchAnyway).toBe(true);
    expect(costEstimate.value).toEqual(response);
    expect(costEstimateLoading.value).toBe(false);
  });

  it.each([
    ['EG-341', new RunSamplesNotCountedError()],
    ['EG-342', new RunCostEstimateFailedError()],
  ])('turns a %s error from the estimate call into a block', async (_code, serverError) => {
    mockEstimateRunCost.mockRejectedValue(requestError(serverError.message));
    labs[LAB_ID].RunLimits = { SamplesBlockAbove: 500, CostBlockAboveUsd: 400 };
    const { review, loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    await loadEstimate();

    expect(review.value.message?.tone).toBe('block');
    expect(review.value.message?.body).toBe(serverError.message);
    expect(review.value.launchDisabled).toBe(true);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("doesn't wait for the estimate in a lab without limits once the lab has reloaded", async () => {
    mockLoadLab.mockResolvedValue(undefined);
    mockEstimateRunCost.mockReturnValue(new Promise(() => {}));
    const { review, loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    loadEstimate().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(review.value.launchDisabled).toBe(false);
  });

  it('disables launch before the estimate loads in a lab with limits', () => {
    labs[LAB_ID].RunLimits = { SamplesBlockAbove: 500 };
    const { review } = useRunLimitReview(LAB_ID, () => request);

    expect(review.value.launchDisabled).toBe(true);
  });

  it('marks limits not checked when the estimate call fails', async () => {
    mockEstimateRunCost.mockRejectedValue(requestError('boom'));
    labs[LAB_ID].RunLimits = { CostBlockAboveUsd: 400 };
    const { review, costEstimate, loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    await loadEstimate();

    expect(review.value.message?.title).toBe('Limits not checked');
    expect(review.value.launchDisabled).toBe(false);
    expect(costEstimate.value).toBeNull();
    expect(console.warn).toHaveBeenCalledWith('Pre-run cost estimate unavailable:', expect.any(Error));
  });

  it('handles a launch-time limit block', async () => {
    mockEstimateRunCost.mockResolvedValue(availableEstimate);
    const { review, loadEstimate, handleLaunchError } = useRunLimitReview(LAB_ID, () => request);
    await loadEstimate();
    const serverMessage = new RunSampleLimitExceededError(2, 1).message;

    const handled = await handleLaunchError(requestError(serverMessage));

    expect(handled).toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(serverMessage);
    expect(review.value.message?.body).toBe(serverMessage);
    expect(review.value.launchDisabled).toBe(true);
  });

  // The Samples row reads the lab's limits from the store, which predate the change that caused the block.
  it('reloads the lab after a launch-time limit block so the Samples row shows the current limit', async () => {
    mockEstimateRunCost.mockResolvedValue(availableEstimate);
    const { loadEstimate, handleLaunchError } = useRunLimitReview(LAB_ID, () => request);
    await loadEstimate();
    mockLoadLab.mockClear();

    await handleLaunchError(requestError(new RunSampleLimitExceededError(2, 1).message));

    expect(mockLoadLab).toHaveBeenCalledWith(LAB_ID);
  });

  it('leaves other launch errors to the caller', async () => {
    mockEstimateRunCost.mockResolvedValue(availableEstimate);
    const { review, loadEstimate, handleLaunchError } = useRunLimitReview(LAB_ID, () => request);
    await loadEstimate();
    mockLoadLab.mockClear();
    const before = review.value;

    const handled = await handleLaunchError(requestError('x'));

    expect(handled).toBe(false);
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockLoadLab).not.toHaveBeenCalled();
    expect(review.value).toEqual(before);
  });

  it("sends the caller's request body", async () => {
    mockEstimateRunCost.mockResolvedValue(availableEstimate);
    const { loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    await loadEstimate();

    expect(mockEstimateRunCost).toHaveBeenCalledWith(LAB_ID, request);
  });

  // The lab copy loaded with the wizard can predate a limit change, and it decides whether launch waits for the verdict.
  it('reloads the lab when the review step loads, with launch disabled until it is back', async () => {
    let finishLabReload: () => void = () => {};
    mockLoadLab.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLabReload = () => {
            labs[LAB_ID].RunLimits = { SamplesBlockAbove: 10 };
            resolve();
          };
        }),
    );
    mockEstimateRunCost.mockResolvedValue(availableEstimate);
    const { review, loadEstimate } = useRunLimitReview(LAB_ID, () => request);

    const loading = loadEstimate();
    await Promise.resolve();

    expect(mockLoadLab).toHaveBeenCalledWith(LAB_ID);
    expect(review.value.launchDisabled).toBe(true);

    finishLabReload();
    await loading;

    expect(review.value.launchDisabled).toBe(false);
    expect(review.value.samplesRow?.limitText).toBe('Limit: 10 per run');
  });
});
