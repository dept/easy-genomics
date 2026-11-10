import { createPinia, setActivePinia } from 'pinia';
import useRunCostsStore from '../../../src/app/stores/runCosts';

const listRunCosts = jest.fn();
const toastError = jest.fn();

const ORG_ID = '1f6e0f8e-5d0c-4c58-9d3b-1a2b3c4d5e6f';
const monthQuery = { organizationId: ORG_ID, period: 'month' as const, month: '2026-11' };
const rollingQuery = { organizationId: ORG_ID, period: '30d' as const };

function reportWithCost(cost: number) {
  const figures = { EstimatedCostUsd: cost, FinishedRuns: 1, WarnedRuns: 0, BlockedLaunches: 0 };
  return {
    Period: { Start: '2026-11-01', End: '2026-11-30' },
    PreviousPeriod: { Start: '2026-10-01', End: '2026-10-31' },
    Totals: figures,
    PreviousTotals: figures,
    Labs: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(console, 'error').mockImplementation(() => {});
  listRunCosts.mockReset();
  toastError.mockReset();

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { usage: { listRunCosts } } }),
    useToastStore: () => ({ error: toastError }),
  });
});

describe('runCosts store load', () => {
  it('stores the report and the query it answers', async () => {
    const report = reportWithCost(12.5);
    listRunCosts.mockResolvedValue(report);

    await expect(useRunCostsStore().load(monthQuery)).resolves.toBe(true);

    expect(listRunCosts).toHaveBeenCalledWith(monthQuery);
    expect(useRunCostsStore().report).toEqual(report);
    expect(useRunCostsStore().query).toEqual(monthQuery);
    expect(useRunCostsStore().loading).toBe(false);
  });

  it('is loading while the request is in flight', async () => {
    const pending = deferred<ReturnType<typeof reportWithCost>>();
    listRunCosts.mockReturnValue(pending.promise);

    const loading = useRunCostsStore().load(monthQuery);
    expect(useRunCostsStore().loading).toBe(true);

    pending.resolve(reportWithCost(1));
    await loading;
    expect(useRunCostsStore().loading).toBe(false);
  });

  it('toasts the API message, keeps the last report and returns false', async () => {
    const report = reportWithCost(3);
    listRunCosts.mockResolvedValueOnce(report);
    await useRunCostsStore().load(monthQuery);

    listRunCosts.mockRejectedValueOnce(new Error('Request error: You do not have access to this organization.'));
    await expect(useRunCostsStore().load(rollingQuery)).resolves.toBe(false);

    expect(toastError).toHaveBeenCalledWith('You do not have access to this organization.');
    expect(useRunCostsStore().report).toEqual(report);
    expect(useRunCostsStore().loading).toBe(false);
  });

  it('falls back to a readable message', async () => {
    listRunCosts.mockRejectedValue(new Error('Request error: '));
    await useRunCostsStore().load(monthQuery);
    expect(toastError).toHaveBeenCalledWith("Couldn't load run costs. Please try again.");
  });

  it('ignores a slow response that arrives after a newer load', async () => {
    const slow = deferred<ReturnType<typeof reportWithCost>>();
    const newerReport = reportWithCost(99);
    listRunCosts.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(newerReport);

    const first = useRunCostsStore().load(monthQuery);
    await useRunCostsStore().load(rollingQuery);
    slow.resolve(reportWithCost(1));

    await expect(first).resolves.toBe(false);
    expect(useRunCostsStore().report).toEqual(newerReport);
    expect(useRunCostsStore().query).toEqual(rollingQuery);
    expect(useRunCostsStore().loading).toBe(false);
  });

  it('reset clears the report and drops an in-flight response', async () => {
    const slow = deferred<ReturnType<typeof reportWithCost>>();
    listRunCosts.mockReturnValueOnce(slow.promise);

    const loading = useRunCostsStore().load(monthQuery);
    useRunCostsStore().reset();
    slow.resolve(reportWithCost(1));
    await loading;

    expect(useRunCostsStore().report).toBeNull();
    expect(useRunCostsStore().loading).toBe(false);
  });
});
