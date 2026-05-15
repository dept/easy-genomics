export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (error, _instance, info) => {
    // Log all unhandled Vue component errors for visibility.
    // Components are responsible for their own user-facing error handling
    // (toasts, empty states). The error.vue page is reserved for Nuxt-level
    // fatal errors (navigation failures, SSR errors) which Nuxt routes there
    // automatically without needing showError() here.
    console.error('[Vue error]', { error, info });
  };
});
