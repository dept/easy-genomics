import useAuth from '../../../src/app/composables/useAuth';
import { VALIDATION_MESSAGES } from '../../../src/app/constants/validation';

const mockFetchAuthSession = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();

jest.mock(
  'aws-amplify/auth',
  () => ({
    fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  }),
  { virtual: true },
);

const toastError = jest.fn();
const toastSuccess = jest.fn();
const setRequestPending = jest.fn();
const setRequestComplete = jest.fn();
const setCurrentUserDataFromToken = jest.fn();
const loadOrgs = jest.fn();
const identify = jest.fn();
const track = jest.fn();
const analyticsReset = jest.fn();
const userReset = jest.fn();
const analyticsStoreReset = jest.fn();
const navigateTo = jest.fn();

jest.mock('@FE/stores', () => ({
  resetStores: jest.fn(),
  useToastStore: () => ({ error: toastError, success: toastSuccess }),
  useUiStore: () => ({ setRequestPending, setRequestComplete }),
}));

describe('useAuth', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(global, {
      useUser: () => ({ setCurrentUserDataFromToken }),
      useOrgsStore: () => ({ loadOrgs }),
      useAnalytics: () => ({ identify, track, reset: analyticsReset }),
      useUserStore: () => ({ currentUserDetails: { id: 'user-1' }, reset: userReset }),
      useAnalyticsStore: () => ({ reset: analyticsStoreReset }),
      navigateTo,
    });
  });

  describe('signIn', () => {
    it('shows the credentials toast for NotAuthorizedException', async () => {
      mockSignIn.mockRejectedValue({ name: 'NotAuthorizedException' });
      const { signIn } = useAuth();

      await expect(signIn('a@b.com', 'wrong')).rejects.toEqual({ name: 'NotAuthorizedException' });

      expect(toastError).toHaveBeenCalledWith('Incorrect email or password. Please try again.');
      expect(toastError).not.toHaveBeenCalledWith(VALIDATION_MESSAGES.network);
    });

    it('shows the network toast for any other rejection', async () => {
      mockSignIn.mockRejectedValue({ name: 'NetworkError' });
      const { signIn } = useAuth();

      await expect(signIn('a@b.com', 'secret')).rejects.toEqual({ name: 'NetworkError' });

      expect(toastError).toHaveBeenCalledWith(VALIDATION_MESSAGES.network);
    });

    it('toasts and throws when Amplify returns a challenge nextStep', async () => {
      mockSignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
      });
      const { signIn } = useAuth();

      await expect(signIn('a@b.com', 'temp')).rejects.toMatchObject({ name: 'SignInIncomplete' });

      expect(toastError).toHaveBeenCalledWith(VALIDATION_MESSAGES.network);
      expect(setCurrentUserDataFromToken).not.toHaveBeenCalled();
    });
  });

  describe('getToken', () => {
    it('returns the ID token JWT', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'id-jwt' } },
      });
      const { getToken } = useAuth();

      await expect(getToken()).resolves.toBe('id-jwt');
      expect(mockFetchAuthSession).toHaveBeenCalledWith(undefined);
    });

    it('rejects when the session has no ID token', async () => {
      mockFetchAuthSession.mockResolvedValue({ tokens: undefined });
      const { getToken } = useAuth();

      await expect(getToken()).rejects.toThrow('No ID token in the current session');
    });
  });

  describe('getRefreshedToken', () => {
    it('force-refreshes and returns the new ID token', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'fresh-jwt' } },
      });
      const { getRefreshedToken } = useAuth();

      await expect(getRefreshedToken()).resolves.toBe('fresh-jwt');
      expect(mockFetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it('rejects when a force-refresh returns no ID token', async () => {
      mockFetchAuthSession.mockResolvedValue({ tokens: undefined });
      const { getRefreshedToken } = useAuth();

      await expect(getRefreshedToken()).rejects.toThrow('No ID token after refresh');
    });
  });

  describe('isAuthed', () => {
    it('returns true when getCurrentUser resolves', async () => {
      mockGetCurrentUser.mockResolvedValue({ userId: 'u1' });
      await expect(useAuth().isAuthed()).resolves.toBe(true);
    });

    it('returns false when getCurrentUser rejects', async () => {
      mockGetCurrentUser.mockRejectedValue(new Error('unauthenticated'));
      await expect(useAuth().isAuthed()).resolves.toBe(false);
    });
  });
});
