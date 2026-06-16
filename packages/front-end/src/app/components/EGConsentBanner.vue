<script setup lang="ts">
  /**
   * Privacy-safe analytics consent banner.
   *
   * Only shown when the institution has opted in (ANALYTICS_ENABLED), no
   * browser privacy signal forces analytics off, we are not on a sensitive
   * auth route, and the user has not yet made a choice.
   *
   * "Reject" and "Accept" have equal visual weight (GDPR Art. 7). The default
   * before the user chooses is denied — nothing is sent until "Accept".
   */
  const analytics = useAnalytics();
  const analyticsStore = useAnalyticsStore();

  const submitting = ref(false);
  // Recomputed reactively as the consent choice / route changes.
  const visible = computed<boolean>(() => analytics.canShowConsentBanner() && analyticsStore.consent === 'unset');

  async function accept(): Promise<void> {
    if (submitting.value) return;
    submitting.value = true;
    try {
      await analytics.optIn();
    } finally {
      submitting.value = false;
    }
  }

  async function reject(): Promise<void> {
    if (submitting.value) return;
    submitting.value = true;
    try {
      await analytics.optOut();
    } finally {
      submitting.value = false;
    }
  }
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
      role="dialog"
      aria-live="polite"
      aria-label="Analytics consent"
    >
      <div
        class="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg md:flex-row md:items-center md:justify-between"
      >
        <div class="flex flex-col gap-1">
          <EGText tag="h4" class="font-semibold">Help improve Easy Genomics</EGText>
          <EGText tag="p" class="text-muted text-sm">
            This deployment can send
            <strong>anonymous</strong>
            usage data to DEPT to improve the open-source project. No names, emails, file names, sample data or run
            parameters are ever sent. You can change this any time in your profile.
            <a href="https://easy-genomics.org/privacy" class="text-primary underline" target="_blank" rel="noopener">
              Learn more
            </a>
          </EGText>
        </div>
        <div class="flex flex-shrink-0 gap-3">
          <EGButton variant="secondary" label="Reject" :loading="submitting" @click="reject" />
          <EGButton variant="secondary" label="Accept" :loading="submitting" @click="accept" />
        </div>
      </div>
    </div>
  </Transition>
</template>
