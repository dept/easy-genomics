import useSwitchOrganization from '../../../src/app/composables/useSwitchOrganization';

const updateUserLastAccessInfo = jest.fn();
const getRefreshedToken = jest.fn();
const setCurrentUserDataFromToken = jest.fn();
let userStore: {
  currentOrgId: string;
  currentUserDetails: { id: string };
  mostRecentLab: { LaboratoryId: string | null };
};

beforeEach(() => {
  jest.useFakeTimers();
  updateUserLastAccessInfo.mockReset().mockResolvedValue(undefined);
  getRefreshedToken.mockReset().mockResolvedValue(undefined);
  setCurrentUserDataFromToken.mockReset().mockResolvedValue(undefined);
  userStore = { currentOrgId: 'org-1', currentUserDetails: { id: 'user-1' }, mostRecentLab: { LaboratoryId: 'lab-1' } };

  // useSwitchOrganization relies on Nuxt auto-imports (no explicit import).
  Object.assign(global, {
    useUserStore: () => userStore,
    useUiStore: () => ({
      setRequestPending: jest.fn(),
      setRequestComplete: jest.fn(),
      incrementRemountAppKey: jest.fn(),
    }),
    useNuxtApp: () => ({ $api: { users: { updateUserLastAccessInfo } } }),
    useAuth: () => ({ getRefreshedToken }),
    useUser: () => ({ setCurrentUserDataFromToken }),
    useToastStore: () => ({ success: jest.fn() }),
  });
});

afterEach(() => jest.useRealTimers());

describe('switchTo', () => {
  it('keeps your current lab when the switch fails', async () => {
    updateUserLastAccessInfo.mockRejectedValue(new Error('network'));

    await expect(useSwitchOrganization().switchTo('org-2')).rejects.toThrow('network');

    expect(userStore.mostRecentLab.LaboratoryId).toBe('lab-1');
  });

  it('keeps your current lab when the token refresh fails', async () => {
    getRefreshedToken.mockRejectedValue(new Error('refresh'));

    await expect(useSwitchOrganization().switchTo('org-2')).rejects.toThrow('refresh');

    expect(userStore.mostRecentLab.LaboratoryId).toBe('lab-1');
  });

  it('clears the current lab before reading the new org from the token', async () => {
    let labWhenReadingToken: string | null = 'unread';
    setCurrentUserDataFromToken.mockImplementation(async () => {
      labWhenReadingToken = userStore.mostRecentLab.LaboratoryId;
    });

    const switching = useSwitchOrganization().switchTo('org-2', { showToast: false });
    await jest.runAllTimersAsync();
    await switching;

    expect(labWhenReadingToken).toBeNull();
  });
});
