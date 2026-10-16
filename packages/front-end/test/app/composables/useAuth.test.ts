import useAuth from '../../../src/app/composables/useAuth';
import { VALIDATION_MESSAGES } from '../../../src/app/constants/validation';

const mockFetchAuthSession = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockSignIn = jest.fn();
const mockSignInWithRedirect = jest.fn();
const mockSignOut = jest.fn();
const mockResetStores = jest.fn();

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const toastError = jest.fn();
const toastSuccess = jest.fn();
const setRequestPending = jest.fn();
const setRequestComplete = jest.fn();
const setLoggingOut = jest.fn();
const setCurrentUserDataFromToken = jest.fn();
const loadOrgs = jest.fn();
const identify = jest.fn();
const track = jest.fn();
const analyticsReset = jest.fn();
const userReset = jest.fn();
const analyticsStoreReset = jest.fn();
const navigateTo = jest.fn();

jest.mock('@FE/stores', () => ({
  resetStores: (...args: unknown[]) => mockResetStores(...args),
  useToastStore: () => ({ error: toastError, success: toastSuccess }),
  useUiStore: () => ({ setRequestPending, setRequestComplete, setLoggingOut }),
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

    it('toasts a dedicated message when Amplify returns a challenge nextStep', async () => {
      mockSignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
      });
      const { signIn } = useAuth();

      await expect(signIn('a@b.com', 'temp')).rejects.toMatchObject({ name: 'SignInIncomplete' });

      expect(toastError).toHaveBeenCalledWith(
        'Additional sign-in steps are required. Please contact your administrator.',
      );
      expect(setCurrentUserDataFromToken).not.toHaveBeenCalled();
    });

    it('navigates into the app before analytics on a successful password sign-in', async () => {
      mockSignIn.mockResolvedValue({ isSignedIn: true });
      const { signIn } = useAuth();

      await signIn('a@b.com', 'secret');

      expect(mockSignIn).toHaveBeenCalledWith({ username: 'a@b.com', password: 'secret' });
      expect(setCurrentUserDataFromToken).toHaveBeenCalled();
      expect(loadOrgs).toHaveBeenCalled();
      expect(navigateTo).toHaveBeenCalledWith('/');
      expect(identify).toHaveBeenCalledWith('user-1');
      expect(track).toHaveBeenCalledWith('signed_in', { method: 'password' });

      const navigateOrder = navigateTo.mock.invocationCallOrder[0];
      const identifyOrder = identify.mock.invocationCallOrder[0];
      const trackOrder = track.mock.invocationCallOrder[0];
      expect(navigateOrder).toBeLessThan(identifyOrder);
      expect(identifyOrder).toBeLessThan(trackOrder);
    });
  });

  describe('signInWithGoogle', () => {
    it('starts the Google hosted-UI redirect', async () => {
      mockSignInWithRedirect.mockResolvedValue(undefined);
      await useAuth().signInWithGoogle();
      expect(mockSignInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
    });
  });

  describe('completeOAuthSignIn', () => {
    it('hydrates stores and navigates home when a session exists', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'id-jwt' } },
      });

      await useAuth().completeOAuthSignIn();

      expect(setCurrentUserDataFromToken).toHaveBeenCalled();
      expect(loadOrgs).toHaveBeenCalled();
      expect(navigateTo).toHaveBeenCalledWith('/');
    });

    it('does not navigate when no ID token is present', async () => {
      mockFetchAuthSession.mockResolvedValue({ tokens: undefined });

      await expect(useAuth().completeOAuthSignIn()).rejects.toThrow('No ID token in the current session');
      expect(navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('handleOAuthCallback', () => {
    it('toasts and redirects to /signin when the exchange fails', async () => {
      mockFetchAuthSession.mockResolvedValue({ tokens: undefined });

      await useAuth().handleOAuthCallback();

      expect(toastError).toHaveBeenCalledWith('Sign-in could not be completed. Please try again.');
      expect(navigateTo).toHaveBeenCalledWith('/signin');
    });
  });

  describe('getToken', () => {
    it('returns the ID token JWT', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'id-jwt' } },
      });
      const { getToken } = useAuth();

      await expect(getToken()).resolves.toBe('id-jwt');
      expect(mockFetchAuthSession).toHaveBeenCalledWith({ forceRefresh: false });
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

  describe('signOut', () => {
    it('clears analytics and the user store after Cognito sign-out', async () => {
      mockSignOut.mockResolvedValue(undefined);
      await useAuth().signOut();

      expect(track).toHaveBeenCalledWith('signed_out', {});
      expect(analyticsReset).toHaveBeenCalled();
      expect(analyticsStoreReset).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalled();
      expect(userReset).toHaveBeenCalled();
      expect(setLoggingOut).toHaveBeenCalledWith(false);
    });

    it('clears the logging-out flag and rethrows when Cognito sign-out fails', async () => {
      mockSignOut.mockRejectedValue(new Error('network'));
      await expect(useAuth().signOut()).rejects.toThrow('network');
      expect(setLoggingOut).toHaveBeenCalledWith(false);
    });

    it('keeps the logging-out flag when keepLoggingOutFlag is set', async () => {
      mockSignOut.mockResolvedValue(undefined);
      await useAuth().signOut({ keepLoggingOutFlag: true });
      expect(setLoggingOut).toHaveBeenCalledWith(true);
      expect(setLoggingOut).not.toHaveBeenCalledWith(false);
    });
  });

  describe('signOutAndRedirect', () => {
    it('keeps the logging-out flag, toasts, and resets stores after redirect', async () => {
      mockSignOut.mockResolvedValue(undefined);
      await useAuth().signOutAndRedirect();

      expect(mockSignOut).toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledWith('You have been signed out.');
      expect(navigateTo).toHaveBeenCalledWith('/signin');
      expect(mockResetStores).toHaveBeenCalled();
      expect(setLoggingOut).toHaveBeenCalledWith(true);
      expect(setLoggingOut).not.toHaveBeenCalledWith(false);
    });
  });
});
