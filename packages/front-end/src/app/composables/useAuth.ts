import { CognitoUserSession, CognitoRefreshToken } from 'amazon-cognito-identity-js';
import { Auth } from 'aws-amplify';
import { VALIDATION_MESSAGES } from '@FE/constants/validation';
import { useToastStore, useUiStore } from '@FE/stores';

export default function useAuth() {
  async function isAuthed() {
    try {
      const authenticatedUser = await Auth.currentAuthenticatedUser();
      return !!authenticatedUser;
    } catch (error) {
      console.error('Error occurred getting the authenticated user.', error);
      throw error;
    }
  }

  async function signIn(username: string, password: string) {
    try {
      useUiStore().setRequestPending('signIn');
      const user = await Auth.signIn(username, password);
      if (user) {
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
      if (error.code === 'NotAuthorizedException') {
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
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  }

  /**
   * Get the current refreshed token from the auth JWT
   * @returns {Promise<string>}
   */
  async function getRefreshedToken(): Promise<string> {
    try {
      const currentUser = await Auth.currentAuthenticatedUser();
      if (!currentUser) {
        throw new Error('No current user');
      }

      const newSession: CognitoUserSession = await new Promise((resolve, reject) => {
        currentUser.refreshSession(
          currentUser.getSignInUserSession().getRefreshToken() as CognitoRefreshToken,
          (err: Error, session: CognitoUserSession) => {
            if (err) {
              return reject(err);
            }
            resolve(session);
          },
        );
      });

      return newSession.getIdToken().getJwtToken();
    } catch (error) {
      console.error('Error occurred during token refresh.', error);
      throw error;
    }
  }

  async function signOut() {
    try {
      const analytics = useAnalytics();
      analytics.track('signed_out', {});
      analytics.reset();
      // Clear device consent so the next account on this browser is not opted in
      // by default. Server-side consent is restored on next login via JWT sync.
      useAnalyticsStore().reset();
      await Auth.signOut();
      useUserStore().reset();
    } catch (error) {
      console.error('Error occurred during sign out.', error);
      throw error;
    }
  }

  async function signOutAndRedirect() {
    await signOut();
    useToastStore().success('You have been signed out.');
    await navigateTo('/signin');
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
