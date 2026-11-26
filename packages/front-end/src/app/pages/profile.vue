<script setup lang="ts">
  import type { Form } from '#ui/types';
  import { ProfileDetails, ProfileDetailsSchema } from '@FE/types/user';
  import { profileBackLink } from '@FE/utils/profile-back-link';

  const { $api } = useNuxtApp();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  const labsStore = useLabsStore();
  const analytics = useAnalytics();
  const analyticsStore = useAnalyticsStore();

  // Only surface the privacy control when the institution has opted in.
  const showAnalyticsControl = computed<boolean>(() => analytics.isInstitutionEnabled());
  const analyticsForceDisabled = computed<boolean>(() => analytics.isForceDisabled());
  const analyticsConsentGranted = computed<boolean>(() => analyticsStore.consent === 'granted');
  const analyticsUpdating = ref(false);

  // Read once: the route middleware overwrites previousPageRoute as the user leaves this page.
  const backLink = profileBackLink(uiStore.previousPageRoute, (labId) => labsStore.labs[labId]?.Name);

  async function onToggleAnalytics(granted: boolean): Promise<void> {
    if (analyticsUpdating.value) return;
    analyticsUpdating.value = true;
    try {
      if (granted) {
        await analytics.optIn();
      } else {
        await analytics.optOut();
      }
    } finally {
      analyticsUpdating.value = false;
    }
  }

  const state = ref<ProfileDetails>({
    firstName: userStore.currentUserDetails.firstName || '',
    lastName: userStore.currentUserDetails.lastName || '',
  });
  const profileDetailsForm = ref<Form<ProfileDetails> | null>(null);
  const nameFields = ref<HTMLElement | null>(null);

  const notifyOnOwnRunsEnabled = ref(false);
  const notificationEventFilter = ref<'all_terminal' | 'failures_only' | 'successes_only'>('all_terminal');
  const notificationPrefsLoading = ref(true);
  const notificationPrefsUpdating = ref(false);

  onMounted(async () => {
    try {
      const currentUser = await $api.users.getUser();
      notifyOnOwnRunsEnabled.value = currentUser.NotifyOnOwnRuns === true;
      notificationEventFilter.value = currentUser.NotificationEventFilter ?? 'all_terminal';
    } catch (e) {
      console.error('error while loading notification preferences:', e);
      useToastStore().error('Error loading notification preferences');
    } finally {
      notificationPrefsLoading.value = false;
    }
  });

  async function onToggleNotifyOnOwnRuns(enabled: boolean): Promise<void> {
    if (notificationPrefsUpdating.value) return;
    notificationPrefsUpdating.value = true;
    try {
      await $api.users.updateUser(userStore.currentUserDetails.id!, { NotifyOnOwnRuns: enabled });
      notifyOnOwnRunsEnabled.value = enabled;
    } catch (e) {
      console.error('error while updating run notification preference:', e);
      useToastStore().error('Error updating notification preference');
    } finally {
      notificationPrefsUpdating.value = false;
    }
  }

  async function onChangeNotificationEventFilter(
    filter: 'all_terminal' | 'failures_only' | 'successes_only',
  ): Promise<void> {
    if (notificationPrefsUpdating.value) return;
    notificationPrefsUpdating.value = true;
    try {
      await $api.users.updateUser(userStore.currentUserDetails.id!, { NotificationEventFilter: filter });
      notificationEventFilter.value = filter;
    } catch (e) {
      console.error('error while updating notification event filter:', e);
      useToastStore().error('Error updating notification preference');
    } finally {
      notificationPrefsUpdating.value = false;
    }
  }

  const isDirty = computed<boolean>(
    () =>
      state.value.firstName !== (userStore.currentUserDetails.firstName || '') ||
      state.value.lastName !== (userStore.currentUserDetails.lastName || ''),
  );

  const allowSubmit = computed<boolean>(() => {
    const formValid = ProfileDetailsSchema.safeParse(state.value).success;

    const formSubmitting = uiStore.isRequestPending('editProfileDetails');

    return isDirty.value && formValid && !formSubmitting;
  });

  const justSaved = ref(false);

  // The save itself resets state to the saved values, so only a real edit clears "Saved".
  watch(
    state,
    () => {
      if (isDirty.value) justSaved.value = false;
    },
    { deep: true },
  );

  function onCancel(): void {
    state.value = {
      firstName: userStore.currentUserDetails.firstName || '',
      lastName: userStore.currentUserDetails.lastName || '',
    };
    profileDetailsForm.value?.clear();
    // Cancel unmounts itself, so hand keyboard focus back to the form instead of losing it.
    nextTick(() => nameFields.value?.querySelector('input')?.focus());
  }

  async function onSubmit(): Promise<void> {
    uiStore.setRequestPending('editProfileDetails');

    try {
      await $api.users.updateUser(userStore.currentUserDetails.id!, {
        FirstName: state.value.firstName,
        LastName: state.value.lastName,
      });

      // refresh auth session to get updated user details
      await useAuth().getRefreshedToken();
      await useUser().setCurrentUserDataFromToken();

      state.value = {
        firstName: userStore.currentUserDetails.firstName || '',
        lastName: userStore.currentUserDetails.lastName || '',
      };
      justSaved.value = true;
    } catch (e) {
      console.error('error while updating user details:', e);
      useToastStore().error('Error updating user details');
    }

    uiStore.setRequestComplete('editProfileDetails');
  }

  const resetLinkSent = ref(false);

  async function onSendResetLink(): Promise<void> {
    if (uiStore.isRequestPending('profileResetLink')) return;
    uiStore.setRequestPending('profileResetLink');
    try {
      await $api.users.forgotPasswordRequest(userStore.currentUserDetails.email!);
      resetLinkSent.value = true;
    } catch (e) {
      console.error('error while sending the password reset link:', e);
      useToastStore().error('Error sending the password reset link');
    } finally {
      uiStore.setRequestComplete('profileResetLink');
    }
  }
</script>

<template>
  <EGPageHeader
    title="Your profile"
    description="Your details, sign-in and the emails Easy Genomics sends you."
    :show-back="true"
    :back-button-label="backLink.label"
    :back-action="() => navigateTo(backLink.to)"
  />

  <div class="flex w-full max-w-[720px] flex-col gap-4">
    <EGCard as="section" aria-labelledby="profile-personal-details-title" :padding="0">
      <UForm
        ref="profileDetailsForm"
        :schema="ProfileDetailsSchema"
        :state="state"
        @submit="onSubmit"
        aria-label="Edit profile details"
      >
        <div class="flex items-center gap-4 px-6 pt-6">
          <span
            class="bg-primary inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-medium text-white"
            aria-hidden="true"
          >
            {{ userStore.currentUserInitials }}
          </span>
          <div class="min-w-0">
            <p class="text-heading font-serif text-lg font-medium leading-[22px]">
              {{ userStore.currentUserDisplayName }}
            </p>
            <p class="text-muted mt-1 text-sm [overflow-wrap:anywhere]">{{ userStore.currentUserDetails.email }}</p>
          </div>
        </div>

        <div class="px-6 pt-5">
          <EGText id="profile-personal-details-title" tag="h4">Personal details</EGText>
          <EGText tag="p" color-class="text-muted" class="mt-1.5 text-sm">
            How your name shows to others in your labs, on runs you start and in the audit log.
          </EGText>
        </div>

        <div ref="nameFields" class="grid grid-cols-1 gap-x-4 px-6 pb-6 pt-5 sm:grid-cols-2">
          <EGFormGroup label="First name" name="firstName" eager-validation required>
            <EGInput
              v-model="state.firstName"
              required
              autocomplete="given-name"
              :disabled="uiStore.isRequestPending('editProfileDetails')"
            />
          </EGFormGroup>

          <EGFormGroup label="Last name" name="lastName" eager-validation required>
            <EGInput
              v-model="state.lastName"
              required
              autocomplete="family-name"
              :disabled="uiStore.isRequestPending('editProfileDetails')"
            />
          </EGFormGroup>

          <EGFormGroup
            label="Email"
            name="email"
            help="You sign in with this. To change it, ask an organization admin."
            class="!mb-0 sm:col-span-2"
          >
            <EGInput :model-value="userStore.currentUserDetails.email" disabled />
          </EGFormGroup>
        </div>

        <div class="border-stroke-light flex flex-wrap items-center justify-end gap-3 border-t px-6 py-3.5">
          <span
            role="status"
            class="mr-auto text-sm"
            :class="isDirty ? 'text-alert-caution-text' : 'text-alert-success-text'"
          >
            {{ isDirty ? 'Unsaved changes' : justSaved ? 'Saved' : '' }}
          </span>
          <EGButton
            v-if="isDirty"
            variant="secondary"
            size="sm"
            label="Cancel"
            :disabled="uiStore.isRequestPending('editProfileDetails')"
            @click="onCancel"
          />
          <EGButton type="submit" size="sm" label="Save changes" :disabled="!allowSubmit" />
        </div>
      </UForm>
    </EGCard>

    <EGCard as="section" aria-labelledby="profile-password-title" :padding="0">
      <div class="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
        <div class="min-w-0">
          <EGText id="profile-password-title" tag="h4">Password</EGText>
          <EGText tag="p" color-class="text-muted" class="mt-1.5 text-sm">
            We'll email you a link to set a new one.
          </EGText>
          <p role="status" class="text-alert-success-text text-sm" :class="{ 'mt-2.5': resetLinkSent }">
            <template v-if="resetLinkSent">
              Link sent to {{ userStore.currentUserDetails.email }}. Check your inbox.
            </template>
          </p>
        </div>
        <EGButton
          variant="secondary"
          size="sm"
          :label="resetLinkSent ? 'Send again' : 'Send reset link'"
          @click="onSendResetLink"
        />
      </div>
    </EGCard>

    <!-- Without analytics, the card has nothing to show until notification preferences load. -->
    <EGCard
      v-if="!notificationPrefsLoading || showAnalyticsControl"
      as="section"
      aria-labelledby="profile-preferences-title"
      :padding="0"
    >
      <div class="px-6 pt-5">
        <EGText id="profile-preferences-title" tag="h4">Preferences</EGText>
        <EGText tag="p" color-class="text-muted" class="mt-1.5 text-sm">Saved as soon as you switch them.</EGText>
      </div>

      <div v-if="!notificationPrefsLoading" class="px-6 py-5">
        <div class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <span class="text-heading block text-sm font-medium">Run completion emails</span>
            <EGText tag="p" color-class="text-muted" class="mt-1.5 text-sm">
              Get an email when a run you started finishes, so you don't have to keep the lab open.
            </EGText>
          </div>
          <UToggle
            :model-value="notifyOnOwnRunsEnabled"
            :disabled="notificationPrefsUpdating"
            aria-label="Run completion emails"
            @update:model-value="onToggleNotifyOnOwnRuns"
          />
        </div>
        <div v-if="notifyOnOwnRunsEnabled" class="pt-4">
          <EGFormGroup label="Notify me on" name="notificationEventFilter" class="!mb-0">
            <USelect
              :model-value="notificationEventFilter"
              :disabled="notificationPrefsUpdating"
              :options="[
                { label: 'Every finished run', value: 'all_terminal' },
                { label: 'Failed runs only', value: 'failures_only' },
                { label: 'Succeeded runs only', value: 'successes_only' },
              ]"
              @update:model-value="onChangeNotificationEventFilter"
            />
          </EGFormGroup>
        </div>
      </div>

      <div
        v-if="showAnalyticsControl"
        class="flex items-start justify-between gap-6 px-6 py-5"
        :class="{ 'border-stroke-light border-t': !notificationPrefsLoading }"
      >
        <div class="min-w-0">
          <span class="text-heading block text-sm font-medium">Share anonymous usage data</span>
          <EGText tag="p" color-class="text-muted" class="mt-1.5 text-sm">
            Helps DEPT® improve Easy Genomics. Names, emails, file names, sample data and run parameters are never sent.
            <a href="https://easy-genomics.org/privacy" class="text-primary underline" target="_blank" rel="noopener">
              What we collect
            </a>
          </EGText>
          <EGText v-if="analyticsForceDisabled" tag="p" color-class="text-muted" class="mt-1.5 text-xs">
            Analytics is currently disabled by your browser's privacy settings or the environment.
          </EGText>
        </div>
        <UToggle
          :model-value="analyticsConsentGranted"
          :disabled="analyticsForceDisabled || analyticsUpdating"
          aria-label="Share anonymous usage data"
          @update:model-value="onToggleAnalytics"
        />
      </div>
    </EGCard>
  </div>
</template>
