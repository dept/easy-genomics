import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { createPinia, setActivePinia } from 'pinia';
import useFavouriteWorkflowsStore from '../../../src/app/stores/favouriteWorkflows';
import { LabWorkflowAvailability } from '../../../src/app/utils/favourite-workflows';

const LAB_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const OTHER_LAB_ID = 'a1b2c3d4-0000-0000-0000-000000000002';
const USER_ID = 'c6705721-90ba-4d4a-9460-af2828bb4181';

function omicsFavourite(workflowId: string, laboratoryId: string = LAB_ID): FavouriteWorkflow {
  return {
    WorkflowId: workflowId,
    WorkflowName: `Workflow ${workflowId}`,
    Platform: 'AWS HealthOmics',
    LaboratoryId: laboratoryId,
  };
}

/** Only the Omics list was loaded; Seqera stays unverifiable so its favourites are never touched. */
function omicsLoaded(...workflowIds: string[]): LabWorkflowAvailability {
  return {
    'AWS HealthOmics': { state: 'loaded', workflowIds: new Set(workflowIds) },
    'Seqera Cloud': { state: 'unknown' },
  };
}

const updateUser = jest.fn();
const getUser = jest.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  // The store logs failed writes; the failure cases here would otherwise flood the test output.
  jest.spyOn(console, 'error').mockImplementation(() => {});

  updateUser.mockReset().mockResolvedValue({});
  getUser.mockReset().mockResolvedValue({});

  // Nuxt auto-imports used by the store.
  Object.assign(global, {
    useNuxtApp: () => ({ $api: { users: { getUser, updateUser } } }),
    useUserStore: () => ({ currentUserDetails: { id: USER_ID } }),
    useToastStore: () => ({ success: jest.fn(), error: jest.fn() }),
  });
});

describe('favourite workflows store', () => {
  it('load coalesces concurrent requests', async () => {
    getUser.mockResolvedValue({ FavouriteWorkflows: [omicsFavourite('kept')] });
    const store = useFavouriteWorkflowsStore();

    await Promise.all([store.load(), store.load()]);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('kept')]);
  });

  it('pruneMissingForLab saves the list without the deleted workflows', async () => {
    const store = useFavouriteWorkflowsStore();
    store.favouriteWorkflows = [
      omicsFavourite('kept'),
      omicsFavourite('deleted'),
      omicsFavourite('deleted', OTHER_LAB_ID),
    ];

    const removed = await store.pruneMissingForLab(LAB_ID, omicsLoaded('kept'));

    expect(removed).toEqual([omicsFavourite('deleted')]);
    expect(updateUser).toHaveBeenCalledWith(USER_ID, {
      FavouriteWorkflows: [omicsFavourite('kept'), omicsFavourite('deleted', OTHER_LAB_ID)],
    });
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('kept'), omicsFavourite('deleted', OTHER_LAB_ID)]);
  });

  it('pruneMissingForLab writes nothing when every favourite still exists', async () => {
    const store = useFavouriteWorkflowsStore();
    store.favouriteWorkflows = [omicsFavourite('kept')];

    const removed = await store.pruneMissingForLab(LAB_ID, omicsLoaded('kept'));

    expect(removed).toEqual([]);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('pruneMissingForLab keeps local state when the write fails', async () => {
    updateUser.mockRejectedValue(new Error('network'));
    const store = useFavouriteWorkflowsStore();
    store.favouriteWorkflows = [omicsFavourite('deleted')];

    const removed = await store.pruneMissingForLab(LAB_ID, omicsLoaded());

    expect(removed).toEqual([]);
    expect(store.favouriteWorkflows).toEqual([omicsFavourite('deleted')]);
  });

  it('toggleFavourite adds then removes the same workflow', async () => {
    const store = useFavouriteWorkflowsStore();

    await store.toggleFavourite(omicsFavourite('one'));
    expect(store.isFavourited(LAB_ID, 'one')).toBe(true);

    await store.toggleFavourite(omicsFavourite('one'));
    expect(store.isFavourited(LAB_ID, 'one')).toBe(false);
    expect(updateUser).toHaveBeenLastCalledWith(USER_ID, { FavouriteWorkflows: [] });
  });

  it('toggleFavourite leaves state unchanged when the write fails', async () => {
    updateUser.mockRejectedValue(new Error('network'));
    const store = useFavouriteWorkflowsStore();

    await store.toggleFavourite(omicsFavourite('one'));

    expect(store.favouriteWorkflows).toEqual([]);
  });
});
