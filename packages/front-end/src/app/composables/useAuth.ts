import { fetchAuthSession, getCurrentUser, signIn as amplifySignIn, signOut as amplifySignOut } from 'aws-amplify/auth';
import { VALIDATION_MESSAGES } from '@FE/constants/validation';
import { resetStores, useToastStore, useUiStore } from '@FE/stores';

export default function useAuth() {
  async function isAuthed() {
    try {
      const authenticatedUser = await getCurrentUser();
      return !!authenticatedUser;
    } catch (error) {
      console.error('Error occurred getting the authenticated user.', error);
      throw error;
    }
  }

  async function signIn(username: string, password: string) {
    try {
      useUiStore().setRequestPending('signIn');
      const { isSignedIn } = await amplifySignIn({ username, password });
      if (isSignedIn) {
        await useUser().setCurrentUserDataFromToken();
        await useOrgsStore().loadOrgs();
        // Navigate into the app before emitting analytics so events fire on a
        // non-sensitive route (auth routes like /signin can carry an email in
        // the query string).
        await navigateTo('/');
        const analytics = useAnalytics();
        await analytics.identify(useUserStore().currentUserDetails.id);
        analytics.track('signed_in', { method: 'password' });
      }
    } catch (error: any) {
      // v6 surfaces the Cognito exception on `name`; v5 used `code`.
      if (error.name === 'NotAuthorizedException') {
        useToastStore().error('Incorrect email or password. Please try again.');
      } else {
        useToastStore().error(VALIDATION_MESSAGES.network);
      }
      console.error('Error occurred during sign in.', error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('signIn');
    }
  }

  async function getToken(): Promise<string> {
    const { tokens } = await fetchAuthSession();
    const idToken = tokens?.idToken?.toString();
    // v5's currentSession() rejected without a session; v6 resolves with no
    // tokens, so raise it here to keep callers' error handling intact.
    if (!idToken) {
      throw new Error('No ID token in the current session');
    }
    return idToken;
  }

  /**
   * Get the current refreshed token from the auth JWT
   * @returns {Promise<string>}
   */
  async function getRefreshedToken(): Promise<string> {
    try {
      const { tokens } = await fetchAuthSession({ forceRefresh: true });
      const idToken = tokens?.idToken?.toString();
      // A rejected refresh token resolves with no tokens rather than throwing,
      // which would otherwise drop the Bearer header silently.
      if (!idToken) {
        throw new Error('No ID token after refresh');
      }
      return idToken;
    } catch (error) {
      console.error('Error occurred during token refresh.', error);
      throw error;
    }
  }

  /**
   * Clears Cognito session, analytics, and the user store.
   * Pass `keepLoggingOutFlag: true` when a redirect follows so in-flight lab
   * requests and auth middleware still suppress spurious error toasts.
   */
  async function signOut(options: { keepLoggingOutFlag?: boolean } = {}) {
    const uiStore = useUiStore();
    try {
      uiStore.setLoggingOut(true);
      const analytics = useAnalytics();
      analytics.track('signed_out', {});
      analytics.reset();
      // Clear device consent so the next account on this browser is not opted in
      // by default. Server-side consent is restored on next login via JWT sync.
      useAnalyticsStore().reset();
      await amplifySignOut();
      // Reset user after Cognito clear. Lab watchers no-op when currentOrgId is
      // null or isLoggingOut is set, so this is safe while still on a lab page.
      useUserStore().reset();
      if (!options.keepLoggingOutFlag) {
        uiStore.setLoggingOut(false);
      }
    } catch (error) {
      uiStore.setLoggingOut(false);
      console.error('Error occurred during sign out.', error);
      throw error;
    }
  }

  async function signOutAndRedirect() {
    await signOut({ keepLoggingOutFlag: true });
    useToastStore().success('You have been signed out.');
    await navigateTo('/signin');
    // Lab views are unmounted; wipe remaining stores. isLoggingOut is preserved
    // across uiStore.reset and cleared on the sign-in page mount.
    resetStores();
  }

  return {
    getToken,
    getRefreshedToken,
    isAuthed,
    signIn,
    signOut,
    signOutAndRedirect,
  };
}
