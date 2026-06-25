/**
 * Bootstraps privacy-safe upstream analytics.
 *
 * This plugin is a strict no-op unless the institution opted in
 * (ANALYTICS_ENABLED) and the end user has already granted consent on this
 * device. In that case it lazily loads the PostHog SDK, emits the deferred
 * `app_loaded` event, and tracks sanitized pageviews on navigation.
 *
 * Users who have not yet decided (or who declined) load nothing here — the
 * consent banner (mounted in app.vue) drives opt-in, which loads the SDK on
 * demand via useAnalytics().optIn().
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const analytics = useAnalytics();

  // Nothing to do unless analytics is available for this deployment.
  if (!analytics.isInstitutionEnabled() || analytics.isForceDisabled()) {
    return;
  }

  // Track sanitized pageviews on route change (only emits once consent granted).
  const router = useRouter();
  router.afterEach(() => {
    analytics.page();
  });

  // Returning user who previously granted consent: load the SDK and record boot.
  if (analytics.getConsent() === 'granted') {
    await analytics.load();
    analytics.track('app_loaded', { app_version: analytics.appVersion, env_type: analytics.envType });
  }

  // Expose the analytics API to the app for convenience/debugging.
  nuxtApp.provide('analytics', analytics);
});
