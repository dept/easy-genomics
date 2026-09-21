import { defineNuxtRouteMiddleware } from '#app';
import { fetchAuthSession } from 'aws-amplify/auth';
const baseURL = window.location.origin;

/**
 * @description Routing rules for authed/non-authed users, invoked on every route change
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const url = new URL(to.fullPath, baseURL);

  // If the URL contains an email query parameter (incoming from /accept-invitation) do not redirect
  if (url.pathname === '/accept-invitation' && url.search.startsWith('?email=')) {
    return;
  }

  // accept invite redirect to sign in page
  if (url.pathname === '/accept-invitation') {
    const token = url.searchParams.get('invite');

    // If the 'invite' query parameter is missing or empty, redirect to '/'
    if (!token) {
      return navigateTo('/signin');
    }
  }

  if (url.pathname === '/reset-password') {
    const token = url.searchParams.get('forgot-password');

    // If the 'forgot-password' query parameter is missing or empty, redirect to '/'
    if (!token) {
      return navigateTo('/signin');
    }
  }

  /**
   * @description Redirects for authed/non-authed users
   */
  if (!['/accept-invitation', '/forgot-password', '/reset-password'].includes(url.pathname)) {
    try {
      // fetchAuthSession rather than getCurrentUser: it renews an expired ID
      // token, so a mid-session expiry does not bounce the user to /signin.
      const { tokens } = await fetchAuthSession();

      // v5's currentAuthenticatedUser() rejected when there was no session, so
      // the signed-out redirect below has always been owned by the catch block.
      if (!tokens?.idToken) {
        throw new Error('No authenticated session');
      }

      // if user is signed in redirect to Labs page
      if (url.pathname === '/signin') {
        return await navigateTo('/labs');
      }
    } catch (e) {
      if (to.fullPath !== '/signin') {
        if (!useUiStore().isLoggingOut) {
          useToastStore().error('Session error. You have been signed out.');
        }
        return navigateTo('/signin');
      }
    }
  }

  /*
   * @description Handles case where invite link is clicked while signed in as superuser: sign out, then continue
   */
  if (useUserStore().isSuperuser && url.pathname === '/accept-invitation') {
    const { signOut } = useAuth();
    await signOut();
    return;
  }

  /**
   * @description Redirects for superuser/non-superuser - non-superuser cannot access /admin, superuser can only access /admin
   */
  if (useUserStore().isSuperuser && !to.fullPath.startsWith('/admin')) {
    return navigateTo('/admin' + to.fullPath);
  }
  if (!useUserStore().isSuperuser && to.fullPath.startsWith('/admin')) {
    return navigateTo(to.fullPath.replace(/^\/admin/, ''));
  }
});
