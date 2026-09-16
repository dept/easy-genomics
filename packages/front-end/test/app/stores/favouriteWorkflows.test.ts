import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { createPinia, setActivePinia } from 'pinia';
import useFavouriteWorkflowsStore from '../../../src/app/stores/favouriteWorkflows';

const LAB_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const USER_ID = 'c6705721-90ba-4d4a-9460-af2828bb4181';

function omicsFavourite(workflowId: string, laboratoryId: string = LAB_ID): FavouriteWorkflow {
  return {
    WorkflowId: workflowId,
    WorkflowName: `Workflow ${workflowId}`,
    Platform: 'AWS HealthOmics',
    LaboratoryId: laboratoryId,
  };
}

const updateUser = jest.fn();
const getUser = jest.fn();
const toastSuccess = jest.fn();
const toastError = jest.fn();

function serverFavourites(favourites: FavouriteWorkflow[] = []) {
  getUser.mockResolvedValue({ FavouriteWorkflows: favourites });
  updateUser.mockImplementation(async (_userId: string, data: { FavouriteWorkflows?: FavouriteWorkflow[] }) => {
    getUser.mockResolvedValue({ FavouriteWorkflows: data.FavouriteWorkflows ?? [] });
    return {};
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(console, 'error').mockImplementation(() => {});

  updateUser.mockReset().mockResolvedValue({});
  getUser.mockReset().mockResolvedValue({ FavouriteWorkflows: [] });
  toastSuccess.mockReset();
  toastError.mockReset();

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { users: { getUser, updateUser } } }),
    useUserStore: () => ({ currentUserDetails: { id: USER_ID } }),
    useToastStore: () => ({ success: toastSuccess, error: toastError }),
  });

  useFavouriteWorkflowsStore().reset();
});

describe('favourite workflows store', () => {
  it('load coalesces concurrent requests', async () => {
    getUser.mockResolvedValue({ FavouriteWorkflows: [omicsFavourite('kept')] });
    const store = useFavouriteWorkflowsStore();

    const [first, second] = await Promise.all([store.load(), store.load()]);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('kept')]);
    expect(store.loaded).toBe(true);
  });

  it('load failure leaves state untouched, toasts, and lets the next call retry', async () => {
    getUser.mockRejectedValueOnce(new Error('network'));
    const store = useFavouriteWorkflowsStore();

    expect(await store.load()).toBe(false);

    expect(store.loaded).toBe(false);
    expect(store.favouriteWorkflows).toEqual([]);
    expect(toastError).toHaveBeenCalledWith('Failed to load favorite workflows. Please refresh.');
    expect(updateUser).not.toHaveBeenCalled();

    getUser.mockResolvedValue({ FavouriteWorkflows: [omicsFavourite('kept')] });
    expect(await store.load()).toBe(true);

    expect(store.loaded).toBe(true);
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('kept')]);
  });

  it('load failure after a successful load keeps the previous favourites', async () => {
    getUser.mockResolvedValueOnce({ FavouriteWorkflows: [omicsFavourite('kept')] });
    const store = useFavouriteWorkflowsStore();
    await store.load();

    getUser.mockRejectedValueOnce(new Error('network'));
    const refreshed = await store.load();

    expect(refreshed).toBe(false);
    expect(store.loaded).toBe(true);
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('kept')]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toggleFavourite aborts when the re-read fails instead of writing a stale snapshot', async () => {
    getUser.mockResolvedValueOnce({ FavouriteWorkflows: [omicsFavourite('local')] });
    const store = useFavouriteWorkflowsStore();
    await store.load();
    toastError.mockReset();

    // Server has another tab's favourite, but this re-read fails — writing the local
    // snapshot would drop it. Abort instead.
    getUser.mockRejectedValueOnce(new Error('network'));
    await store.toggleFavourite(omicsFavourite('one'));

    expect(updateUser).not.toHaveBeenCalled();
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('local')]);
    expect(toastError).toHaveBeenCalledWith('Failed to add workflow to favorites');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('discards an in-flight load after reset so the previous user is not written back', async () => {
    let resolveGetUser: (value: unknown) => void = () => undefined;
    getUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetUser = resolve;
        }),
    );
    const store = useFavouriteWorkflowsStore();
    const pending = store.load();

    store.reset();
    resolveGetUser({ FavouriteWorkflows: [omicsFavourite('stale')] });
    await pending;

    expect(store.favouriteWorkflows).toEqual([]);
    expect(store.loaded).toBe(false);

    getUser.mockResolvedValue({ FavouriteWorkflows: [omicsFavourite('fresh')] });
    await store.load();
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('fresh')]);
  });

  it('toggleFavourite refuses to write when favourites have never loaded', async () => {
    getUser.mockRejectedValue(new Error('network'));
    const store = useFavouriteWorkflowsStore();

    await store.toggleFavourite(omicsFavourite('one'));

    expect(updateUser).not.toHaveBeenCalled();
    expect(store.favouriteWorkflows).toEqual([]);
    expect(store.loaded).toBe(false);
  });

  it('toggleFavourite adds then removes the same workflow from a fresh server snapshot', async () => {
    serverFavourites([]);
    const store = useFavouriteWorkflowsStore();

    await store.toggleFavourite(omicsFavourite('one'));
    expect(store.isFavourited(LAB_ID, 'one')).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith('Workflow added to favorites');

    await store.toggleFavourite(omicsFavourite('one'));
    expect(store.isFavourited(LAB_ID, 'one')).toBe(false);
    expect(updateUser).toHaveBeenLastCalledWith(USER_ID, { FavouriteWorkflows: [] });
    expect(toastSuccess).toHaveBeenLastCalledWith('Workflow removed from favorites');
  });

  it("toggleFavourite re-reads before writing so another session's favourite is kept", async () => {
    serverFavourites([omicsFavourite('from-other-tab')]);
    const store = useFavouriteWorkflowsStore();
    store.loaded = true;
    store.favouriteWorkflows = [];

    await store.toggleFavourite(omicsFavourite('one'));

    expect(updateUser).toHaveBeenCalledWith(USER_ID, {
      FavouriteWorkflows: [omicsFavourite('from-other-tab'), omicsFavourite('one')],
    });
  });

  it('toggleFavourite leaves state unchanged when the write fails', async () => {
    serverFavourites([]);
    updateUser.mockRejectedValue(new Error('network'));
    const store = useFavouriteWorkflowsStore();

    await store.toggleFavourite(omicsFavourite('one'));

    expect(store.favouriteWorkflows).toEqual([]);
    expect(toastError).toHaveBeenCalledWith('Failed to add workflow to favorites');
  });

  it('save throws when there is no signed-in user, and toggle reports the failure', async () => {
    serverFavourites([]);
    const store = useFavouriteWorkflowsStore();
    await store.load();

    Object.assign(global, {
      useUserStore: () => ({ currentUserDetails: { id: undefined } }),
    });

    await expect(store.save([omicsFavourite('one')])).rejects.toThrow(
      'cannot save favorite workflows without a signed-in user',
    );

    await store.toggleFavourite(omicsFavourite('one'));

    expect(store.favouriteWorkflows).toEqual([]);
    expect(toastError).toHaveBeenCalledWith('Failed to add workflow to favorites');
  });

  it('save throws when favourites have not been loaded', async () => {
    const store = useFavouriteWorkflowsStore();

    await expect(store.save([omicsFavourite('one')])).rejects.toThrow(
      'cannot save favorite workflows before they have been loaded',
    );
    expect(updateUser).not.toHaveBeenCalled();
  });
});
