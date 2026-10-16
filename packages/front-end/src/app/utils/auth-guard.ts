/**
 * Paths that must not run the signed-in / signed-out redirect.
 * `/auth/callback` is included so the OAuth exchange (started by the amplify
 * plugin listener) can finish without the guard toasting a session error
 * mid-redirect.
 */
export const AUTH_GUARD_EXEMPT_PATHS = ['/accept-invitation', '/forgot-password', '/reset-password', '/auth/callback'];

export interface AuthGuardTo {
  fullPath: string;
}

/**
 * Injected so this helper can be unit-tested without vue-router. Store flags are
 * getters so they are read after `await getToken()`, matching the previous
 * middleware (a sign-out that starts during refresh must still suppress the
 * session-error toast).
 */
export interface AuthGuardContext {
  getToken: () => Promise<string>;
  navigateTo: (path: string) => unknown;
  isLoggingOut: () => boolean;
  toastSessionError: () => void;
  isSuperuser: () => boolean;
  signOut: () => Promise<void>;
}

/**
 * Routing rules for authed/non-authed users. Extracted from the Nuxt middleware
 * so the cases can be unit-tested without vue-router.
 */
export async function resolveAuthGuard(to: AuthGuardTo, origin: string, ctx: AuthGuardContext): Promise<unknown> {
  const url = new URL(to.fullPath, origin);

  // If the URL contains an email query parameter (incoming from /accept-invitation) do not redirect
  if (url.pathname === '/accept-invitation' && url.search.startsWith('?email=')) {
    return;
  }

  // accept invite redirect to sign in page
  if (url.pathname === '/accept-invitation') {
    const token = url.searchParams.get('invite');

    // If the 'invite' query parameter is missing or empty, redirect to '/'
    if (!token) {
      return ctx.navigateTo('/signin');
    }
  }

  if (url.pathname === '/reset-password') {
    const token = url.searchParams.get('forgot-password');

    // If the 'forgot-password' query parameter is missing or empty, redirect to '/'
    if (!token) {
      return ctx.navigateTo('/signin');
    }
  }

  /**
   * @description Redirects for authed/non-authed users
   */
  if (!AUTH_GUARD_EXEMPT_PATHS.includes(url.pathname)) {
    try {
      // getToken uses fetchAuthSession, which renews an expired ID token so a
      // mid-session expiry does not bounce the user to /signin.
      await ctx.getToken();

      // if user is signed in redirect to Labs page
      if (url.pathname === '/signin') {
        return ctx.navigateTo('/labs');
      }
    } catch {
      if (to.fullPath !== '/signin') {
        if (!ctx.isLoggingOut()) {
          ctx.toastSessionError();
        }
        return ctx.navigateTo('/signin');
      }
    }
  }

  /*
   * @description Handles case where invite link is clicked while signed in as superuser: sign out, then continue
   */
  if (ctx.isSuperuser() && url.pathname === '/accept-invitation') {
    await ctx.signOut();
    return;
  }

  /**
   * @description Redirects for superuser/non-superuser - non-superuser cannot access /admin, superuser can only access /admin
   */
  if (ctx.isSuperuser() && !to.fullPath.startsWith('/admin')) {
    return ctx.navigateTo('/admin' + to.fullPath);
  }
  if (!ctx.isSuperuser() && to.fullPath.startsWith('/admin')) {
    return ctx.navigateTo(to.fullPath.replace(/^\/admin/, ''));
  }
}
