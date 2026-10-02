import { createPinia, setActivePinia } from 'pinia';
import useLabsStore from '../../../src/app/stores/labs';

const labDetails = jest.fn();
const toastError = jest.fn();
const isAuthed = jest.fn();
let isLoggingOut = false;

beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(console, 'error').mockImplementation(() => {});

  labDetails.mockReset().mockRejectedValue(new Error('network'));
  toastError.mockReset();
  isAuthed.mockReset().mockResolvedValue(true);
  isLoggingOut = false;

  Object.assign(global, {
    useNuxtApp: () => ({ $api: { labs: { labDetails, list: jest.fn() } } }),
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
