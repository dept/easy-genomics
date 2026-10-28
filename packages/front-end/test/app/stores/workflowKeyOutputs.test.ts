import { createPinia, setActivePinia } from 'pinia';
import useWorkflowKeyOutputsStore from '../../../src/app/stores/workflowKeyOutputs';

const mockList = jest.fn();
const mockEdit = jest.fn();
const mockEditDelivery = jest.fn();
const mockRunMatches = jest.fn();
const mockToastError = jest.fn();
const mockSetRequestPending = jest.fn();
const mockSetRequestComplete = jest.fn();

(global as { useNuxtApp?: () => unknown }).useNuxtApp = () => ({
  $api: {
    workflowKeyOutputs: {
      list: mockList,
      edit: mockEdit,
      editDelivery: mockEditDelivery,
      runMatches: mockRunMatches,
    },
  },
});

(global as { useToastStore?: () => unknown }).useToastStore = () => ({ error: mockToastError });
(global as { useUiStore?: () => unknown }).useUiStore = () => ({
  setRequestPending: mockSetRequestPending,
  setRequestComplete: mockSetRequestComplete,
});

const LAB_ID = 'lab-1';
const WORKFLOW_ID = 'wf-1';

describe('workflowKeyOutputs store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useWorkflowKeyOutputsStore().reset();
    mockList.mockReset();
    mockEdit.mockReset();
    mockEditDelivery.mockReset();
    mockRunMatches.mockReset();
    mockToastError.mockReset();
  });

  it('caches a loaded definition', async () => {
    mockList.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      KeyOutputs: [],
    });
    const store = useWorkflowKeyOutputsStore();

    await store.load(LAB_ID, WORKFLOW_ID);

    expect(store.definitionFor(LAB_ID, WORKFLOW_ID)?.WorkflowId).toBe(WORKFLOW_ID);
  });

  it('toasts when load fails', async () => {
    mockList.mockRejectedValue(new Error('network'));
    const store = useWorkflowKeyOutputsStore();

    await store.load(LAB_ID, WORKFLOW_ID);

    expect(mockToastError).toHaveBeenCalled();
    expect(store.definitionFor(LAB_ID, WORKFLOW_ID)).toBeNull();
  });

  it('caches save and saveDelivery results', async () => {
    mockEdit.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      KeyOutputs: [{ KeyOutputId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', Label: 'Summary', Pattern: 'a.html' }],
    });
    mockEditDelivery.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      KeyOutputs: [],
      Delivery: { Enabled: true, DestinationUri: 's3://results-bucket/incoming/' },
    });
    const store = useWorkflowKeyOutputsStore();

    expect(await store.save(LAB_ID, WORKFLOW_ID, [{ Label: 'Summary', Pattern: 'a.html' }])).toBe(true);
    expect(store.definitionFor(LAB_ID, WORKFLOW_ID)?.KeyOutputs).toHaveLength(1);

    expect(
      await store.saveDelivery(LAB_ID, WORKFLOW_ID, { Enabled: true, DestinationUri: 's3://results-bucket/incoming/' }),
    ).toBe(true);
    expect(store.definitionFor(LAB_ID, WORKFLOW_ID)?.Delivery?.Enabled).toBe(true);
  });

  it('caches loadRunMatches results', async () => {
    mockRunMatches.mockResolvedValue({
      LaboratoryId: LAB_ID,
      RunId: 'run-1',
      KeyOutputs: [],
    });
    const store = useWorkflowKeyOutputsStore();

    await store.loadRunMatches(LAB_ID, 'run-1');

    expect(store.matchesFor(LAB_ID, 'run-1')?.RunId).toBe('run-1');
  });

  it('toasts when loadRunMatches fails', async () => {
    mockRunMatches.mockRejectedValue(new Error('network'));
    const store = useWorkflowKeyOutputsStore();

    expect(await store.loadRunMatches(LAB_ID, 'run-1')).toBeNull();
    expect(mockToastError).toHaveBeenCalled();
  });

  it('toasts when save fails', async () => {
    mockEdit.mockRejectedValue(new Error('denied'));
    const store = useWorkflowKeyOutputsStore();

    expect(await store.save(LAB_ID, WORKFLOW_ID, [{ Label: 'Summary', Pattern: 'a.html' }])).toBe(false);
    expect(mockToastError).toHaveBeenCalled();
  });

  it('toasts when saveDelivery fails', async () => {
    mockEditDelivery.mockRejectedValue(new Error('denied'));
    const store = useWorkflowKeyOutputsStore();

    expect(await store.saveDelivery(LAB_ID, WORKFLOW_ID, { Enabled: true, DestinationUri: 's3://x/y' })).toBe(false);
    expect(mockToastError).toHaveBeenCalled();
  });
});
