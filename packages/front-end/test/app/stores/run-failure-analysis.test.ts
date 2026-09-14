import { createPinia, setActivePinia } from 'pinia';
import useRunStore from '../../../src/app/stores/run';

jest.mock('@FE/components/EGRunFormUploadData.vue', () => ({}));

const mockRequest = jest.fn();
const mockReadLabRun = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

(global as any).useNuxtApp = () => ({
  $api: {
    labs: {
      requestLabRunFailureAnalysis: mockRequest,
      readLabRun: mockReadLabRun,
    },
  },
});

(global as any).useToastStore = () => ({
  error: mockToastError,
  success: mockToastSuccess,
});

describe('requestFailureAnalysis', () => {
  let store: ReturnType<typeof useRunStore>;

  beforeEach(() => {
    jest.useFakeTimers();
    setActivePinia(createPinia());
    store = useRunStore();
    mockRequest.mockReset();
    mockReadLabRun.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toasts the mapped message when the request is rejected up front', async () => {
    mockRequest.mockRejectedValue({ errorCode: 'EG-337', message: 'No LLM provider is configured' });
    await store.requestFailureAnalysis('lab-1', 'run-1');
    expect(mockToastError).toHaveBeenCalled();
  });

  it('stops polling and toasts success once the status reaches Succeeded', async () => {
    mockReadLabRun
      .mockResolvedValueOnce({ RunId: 'run-1', AnalysisStatus: 'Running' })
      .mockResolvedValueOnce({ RunId: 'run-1', AnalysisStatus: 'Succeeded', FailureOwner: 'Lab' });
    await store.requestFailureAnalysis('lab-1', 'run-1');
    await jest.advanceTimersByTimeAsync(6000);
    expect(mockToastSuccess).toHaveBeenCalled();
    expect(store.analysisPolls['run-1']).toBeUndefined();
  });

  it('stops polling and toasts the mapped error once the status reaches Failed', async () => {
    mockReadLabRun.mockResolvedValue({
      RunId: 'run-1',
      AnalysisStatus: 'Failed',
      AnalysisErrorCode: 'INVALID_MODEL_ID',
    });
    await store.requestFailureAnalysis('lab-1', 'run-1');
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Lab Settings'));
    expect(store.analysisPolls['run-1']).toBeUndefined();
  });

  it('gives up after the timeout rather than polling forever', async () => {
    mockReadLabRun.mockResolvedValue({ RunId: 'run-1', AnalysisStatus: 'Running' });
    await store.requestFailureAnalysis('lab-1', 'run-1');
    await jest.advanceTimersByTimeAsync(95_000);
    expect(store.analysisPolls['run-1']).toBeUndefined();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('taking longer than expected'));
  });

  it('stopAnalysisPolling clears an in-flight poll', async () => {
    mockReadLabRun.mockResolvedValue({ RunId: 'run-1', AnalysisStatus: 'Running' });
    await store.requestFailureAnalysis('lab-1', 'run-1');
    store.stopAnalysisPolling('run-1');
    expect(store.analysisPolls['run-1']).toBeUndefined();
  });
});
