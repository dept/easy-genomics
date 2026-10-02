import { defineNuxtRouteMiddleware } from '#app';
import { resolveAuthGuard } from '@FE/utils/auth-guard';

const baseURL = window.location.origin;

/**
 * @description Routing rules for authed/non-authed users, invoked on every route change
 */
export default defineNuxtRouteMiddleware(async (to) => {
  return resolveAuthGuard(to, baseURL, {
    getToken: () => useAuth().getToken(),
    navigateTo,
    isLoggingOut: () => useUiStore().isLoggingOut,
    toastSessionError: () => useToastStore().error('Session error. You have been signed out.'),
    isSuperuser: () => useUserStore().isSuperuser,
    signOut: () => useAuth().signOut(),
  });
});
