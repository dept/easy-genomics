import useOrgLabNavigation from '../../../src/app/composables/useOrgLabNavigation';

const switchTo = jest.fn();
const navigateTo = jest.fn();
const toastSuccess = jest.fn();
const toastError = jest.fn();
let currentOrgId: string | null = 'o1';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  switchTo.mockReset().mockResolvedValue(undefined);
  navigateTo.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockReset();
  toastError.mockReset();
  currentOrgId = 'o1';

  // useOrgLabNavigation relies on Nuxt auto-imports (no explicit import).
  Object.assign(global, {
    useSwitchOrganization: () => ({ switchTo }),
    useUserStore: () => ({ currentOrgId }),
    useToastStore: () => ({ success: toastSuccess, error: toastError }),
    navigateTo,
  });
});

describe('goInOrg', () => {
  it('navigates without switching when the org is already the working org', async () => {
    await expect(useOrgLabNavigation().goInOrg('o1', '/labs/l1')).resolves.toBe(true);

    expect(switchTo).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith('/labs/l1');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('switches first, then navigates, then announces the arrival', async () => {
    await useOrgLabNavigation().goInOrg('o2', '/labs/l9', {
      labName: 'Demo Lab',
      orgName: 'Demonstration Organization',
    });

    expect(switchTo).toHaveBeenCalledWith('o2', { showToast: false });
    expect(switchTo.mock.invocationCallOrder[0]).toBeLessThan(navigateTo.mock.invocationCallOrder[0]);
    expect(navigateTo).toHaveBeenCalledWith('/labs/l9');
    expect(toastSuccess).toHaveBeenCalledWith('Now working in Demo Lab, Demonstration Organization');
  });

  it('stays put and shows an error when the switch fails', async () => {
    switchTo.mockRejectedValue(new Error('refresh failed'));

    await expect(useOrgLabNavigation().goInOrg('o2', '/labs/l9')).resolves.toBe(false);

    expect(navigateTo).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Couldn't switch organization. Please try again.");
  });
});
