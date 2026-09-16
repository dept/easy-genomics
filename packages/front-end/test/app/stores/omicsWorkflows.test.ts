import { createPinia, setActivePinia } from 'pinia';
import useOmicsWorkflowsStore from '../../../src/app/stores/omicsWorkflows';

const LAB_ID = 'lab-1';

const list = jest.fn();
const listShared = jest.fn();
const toastError = jest.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(console, 'error').mockImplementation(() => {});

  list.mockReset();
  listShared.mockReset();
  toastError.mockReset();

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { omicsWorkflows: { list, listShared } } }),
    useToastStore: () => ({ error: toastError }),
  });

  useOmicsWorkflowsStore().reset();
});

describe('omics workflows store', () => {
  it('marks the lab list complete when private and shared both resolve', async () => {
    list.mockResolvedValue({ items: [{ id: 'private-1', name: 'Private' }] });
    listShared.mockResolvedValue({ items: [{ id: 'shared-1', name: 'Shared' }] });
    const store = useOmicsWorkflowsStore();

    await store.loadWorkflowsForLab(LAB_ID);

    expect(store.hasCompleteWorkflowList(LAB_ID)).toBe(true);
    expect(store.workflowsForLab(LAB_ID).map((w) => w.id)).toEqual(['private-1', 'shared-1']);
  });

  it('keeps private workflows but marks the list incomplete when shared fails', async () => {
    list.mockResolvedValue({ items: [{ id: 'private-1', name: 'Private' }] });
    listShared.mockRejectedValue(new Error('shared unavailable'));
    const store = useOmicsWorkflowsStore();

    await store.loadWorkflowsForLab(LAB_ID);

    expect(store.hasCompleteWorkflowList(LAB_ID)).toBe(false);
    expect(store.workflowsForLab(LAB_ID).map((w) => w.id)).toEqual(['private-1']);
    expect(toastError).toHaveBeenCalledWith('Failed to load shared workflows. Please refresh.');
  });
});
