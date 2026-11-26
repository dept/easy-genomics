import { createPinia, setActivePinia } from 'pinia';
import useRunLimitEventsStore from '../../../src/app/stores/runLimitEvents';

const listRunLimitEvents = jest.fn();
const toastError = jest.fn();

const ORG_ID = '1f6e0f8e-5d0c-4c58-9d3b-1a2b3c4d5e6f';
const blockedQuery = { organizationId: ORG_ID, period: '30d' as const, kind: 'blocked' as const };
const warnedQuery = { organizationId: ORG_ID, period: '30d' as const, kind: 'warned' as const };

const responseWithTruncated = (truncated: boolean) => ({ Events: [], Truncated: truncated });

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
  listRunLimitEvents.mockReset();
  toastError.mockReset();

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { usage: { listRunLimitEvents } } }),
    useToastStore: () => ({ error: toastError }),
  });
});

describe('runLimitEvents store load', () => {
  it('stores the response and the query it answers', async () => {
    const response = responseWithTruncated(true);
    listRunLimitEvents.mockResolvedValue(response);

    await expect(useRunLimitEventsStore().load(blockedQuery)).resolves.toBe(true);

    expect(listRunLimitEvents).toHaveBeenCalledWith(blockedQuery);
    expect(useRunLimitEventsStore().response).toEqual(response);
    expect(useRunLimitEventsStore().query).toEqual(blockedQuery);
    expect(useRunLimitEventsStore().loading).toBe(false);
  });

  it("keeps only the latest period's response", async () => {
    const slow = deferred<ReturnType<typeof responseWithTruncated>>();
    listRunLimitEvents.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(responseWithTruncated(true));

    const first = useRunLimitEventsStore().load(blockedQuery);
    await useRunLimitEventsStore().load(warnedQuery);
    slow.resolve(responseWithTruncated(false));

    await expect(first).resolves.toBe(false);
    expect(useRunLimitEventsStore().query).toEqual(warnedQuery);
    expect(useRunLimitEventsStore().response?.Truncated).toBe(true);
    expect(useRunLimitEventsStore().loading).toBe(false);
  });

  it('toasts and keeps the last response on error', async () => {
    const response = responseWithTruncated(false);
    listRunLimitEvents.mockResolvedValueOnce(response);
    await useRunLimitEventsStore().load(blockedQuery);
    listRunLimitEvents.mockRejectedValueOnce(new Error('boom'));

    await expect(useRunLimitEventsStore().load(warnedQuery)).resolves.toBe(false);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(useRunLimitEventsStore().response).toEqual(response);
    expect(useRunLimitEventsStore().query).toEqual(blockedQuery);
    expect(useRunLimitEventsStore().loading).toBe(false);
  });

  it('records which query failed, so the panel can say so instead of showing an empty list', async () => {
    listRunLimitEvents.mockRejectedValueOnce(new Error('boom'));

    await useRunLimitEventsStore().load(warnedQuery);

    expect(useRunLimitEventsStore().failedQuery).toEqual(warnedQuery);
  });

  it('clears the failed query once a load succeeds', async () => {
    listRunLimitEvents.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(responseWithTruncated(false));
    await useRunLimitEventsStore().load(warnedQuery);

    await useRunLimitEventsStore().load(warnedQuery);

    expect(useRunLimitEventsStore().failedQuery).toBeNull();
  });

  it('forgets everything on reset', async () => {
    listRunLimitEvents.mockResolvedValue(responseWithTruncated(false));
    await useRunLimitEventsStore().load(blockedQuery);
    listRunLimitEvents.mockRejectedValueOnce(new Error('boom'));
    await useRunLimitEventsStore().load(warnedQuery);

    useRunLimitEventsStore().reset();

    expect(useRunLimitEventsStore().response).toBeNull();
    expect(useRunLimitEventsStore().query).toBeNull();
    expect(useRunLimitEventsStore().failedQuery).toBeNull();
  });
});
