import { createPinia, setActivePinia } from 'pinia';
import useLabsStore from '../../../src/app/stores/labs';

const labDetails = jest.fn();
const updateRunLimits = jest.fn();
const toastError = jest.fn();
const isAuthed = jest.fn();
let isLoggingOut = false;

beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(console, 'error').mockImplementation(() => {});

  labDetails.mockReset().mockRejectedValue(new Error('network'));
  updateRunLimits.mockReset();
  toastError.mockReset();
  isAuthed.mockReset().mockResolvedValue(true);
  isLoggingOut = false;

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { labs: { labDetails, list: jest.fn(), updateRunLimits } } }),
    useToastStore: () => ({ error: toastError }),
    useUiStore: () => ({ isLoggingOut }),
    useAuth: () => ({ isAuthed }),
  });

  useLabsStore().reset();
});

describe('labs store load error toasts', () => {
  it('suppresses the toast while logging out', async () => {
    isLoggingOut = true;
    await useLabsStore().loadLab('lab-1');
    expect(toastError).not.toHaveBeenCalled();
    expect(isAuthed).not.toHaveBeenCalled();
  });

  it('suppresses the toast when there is no session', async () => {
    isAuthed.mockResolvedValue(false);
    await useLabsStore().loadLab('lab-1');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts when the user is still authed', async () => {
    isAuthed.mockResolvedValue(true);
    await useLabsStore().loadLab('lab-1');
    expect(toastError).toHaveBeenCalledWith('Failed to load lab details. Please refresh.');
  });
});

describe('updateRunLimits', () => {
  const saved = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    Name: 'Sequencing',
    RunLimits: { SamplesBlockAbove: 500 },
  };

  it('stores the lab the server returns', async () => {
    updateRunLimits.mockResolvedValue(saved);
    await expect(useLabsStore().updateRunLimits('lab-1', { SamplesBlockAbove: 500 })).resolves.toBe(true);
    expect(updateRunLimits).toHaveBeenCalledWith('lab-1', { SamplesBlockAbove: 500 });
    expect(useLabsStore().labs['lab-1'].RunLimits).toEqual({ SamplesBlockAbove: 500 });
  });

  it('toasts the server message and keeps the old lab on a 400', async () => {
    useLabsStore().labs['lab-1'] = { ...saved, RunLimits: undefined } as any;
    updateRunLimits.mockRejectedValue(
      new Error('Request error: Block above must be higher than warn above for samples per run.'),
    );
    await expect(useLabsStore().updateRunLimits('lab-1', {})).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith('Block above must be higher than warn above for samples per run.');
    expect(useLabsStore().labs['lab-1'].RunLimits).toBeUndefined();
  });

  it('falls back to a generic message', async () => {
    updateRunLimits.mockRejectedValue(new Error(''));
    await useLabsStore().updateRunLimits('lab-1', {});
    expect(toastError).toHaveBeenCalledWith('Failed to save usage limits. Please try again.');
  });
});
