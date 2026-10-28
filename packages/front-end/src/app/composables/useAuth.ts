import {
  fetchAuthSession,
  getCurrentUser,
  signIn as amplifySignIn,
  signInWithRedirect,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { VALIDATION_MESSAGES } from '@FE/constants/validation';
import { resetStores, useToastStore, useUiStore } from '@FE/stores';

export default function useAuth() {
  async function isAuthed() {
    try {
      const authenticatedUser = await getCurrentUser();
      return !!authenticatedUser;
    } catch {
      return false;
    }
  }

  async function enterApp() {
    await useUser().setCurrentUserDataFromToken();
    await useOrgsStore().loadOrgs();
    await navigateTo('/');
  }

  async function signIn(username: string, password: string) {
    try {
      useUiStore().setRequestPending('signIn');
      const { isSignedIn, nextStep } = await amplifySignIn({ username, password });
      if (!isSignedIn) {
        // Amplify resolves (does not throw) for challenges such as a required
        // password change or MFA. The invite flow sets a permanent password, so
        // this is an edge case — still surface it rather than leaving the form stuck.
        const step = nextStep?.signInStep ?? 'unknown';
        throw Object.assign(new Error(`Sign-in incomplete: ${step}`), { name: 'SignInIncomplete' });
      }

      await enterApp();
      // Analytics after navigation so events fire on a non-sensitive route
      // (auth routes like /signin can carry an email in the query string).
      const analytics = useAnalytics();
      await analytics.identify(useUserStore().currentUserDetails.id);
      analytics.track('signed_in', { method: 'password' });
    } catch (error: any) {
      // Amplify surfaces the Cognito exception on `name`.
      if (error.name === 'NotAuthorizedException') {
        useToastStore().error('Incorrect email or password. Please try again.');
      } else if (error.name === 'SignInIncomplete') {
        useToastStore().error('Additional sign-in steps are required. Please contact your administrator.');
      } else {
        useToastStore().error(VALIDATION_MESSAGES.network);
      }
      console.error('Error occurred during sign in.', error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('signIn');
    }
  }

  async function signInWithGoogle() {
    await signInWithRedirect({ provider: 'Google' });
  }

  async function idTokenFromSession(forceRefresh = false): Promise<string> {
    const { tokens } = await fetchAuthSession({ forceRefresh });
    const idToken = tokens?.idToken?.toString();
    // Amplify resolves with no tokens when there is no session; callers treat
    // a missing ID token as an error so the Bearer header is never dropped silently.
    if (!idToken) {
      throw new Error(forceRefresh ? 'No ID token after refresh' : 'No ID token in the current session');
    }
    return idToken;
  }

  async function getToken(): Promise<string> {
    return idTokenFromSession(false);
  }

  /**
   * Get the current refreshed token from the auth JWT
   * @returns {Promise<string>}
   */
  async function getRefreshedToken(): Promise<string> {
    try {
      return await idTokenFromSession(true);
    } catch (error) {
      console.error('Error occurred during token refresh.', error);
      throw error;
    }
  }

  /**
   * Finish Google SSO after /auth/callback: wait for the exchanged session,
   * hydrate stores, and enter the app.
   */
  async function completeOAuthSignIn() {
    await getToken();
    await enterApp();
  }

  async function handleOAuthCallback() {
    try {
      await completeOAuthSignIn();
    } catch (error) {
      console.error('OAuth callback error:', error);
      useToastStore().error('Sign-in could not be completed. Please try again.');
      await navigateTo('/signin');
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
    completeOAuthSignIn,
    getToken,
    getRefreshedToken,
    handleOAuthCallback,
    isAuthed,
    signIn,
    signInWithGoogle,
    signOut,
    signOutAndRedirect,
  };
}
