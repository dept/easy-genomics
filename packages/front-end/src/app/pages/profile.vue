<script setup lang="ts">
  import { ProfileDetails, ProfileDetailsSchema } from '@FE/types/user';

  const { $api } = useNuxtApp();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  const analytics = useAnalytics();
  const analyticsStore = useAnalyticsStore();

  // Only surface the privacy control when the institution has opted in.
  const showAnalyticsControl = computed<boolean>(() => analytics.isInstitutionEnabled());
  const analyticsForceDisabled = computed<boolean>(() => analytics.isForceDisabled());
  const analyticsConsentGranted = computed<boolean>(() => analyticsStore.consent === 'granted');
  const analyticsUpdating = ref(false);

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

  const allowSubmit = computed<boolean>(() => {
    const formDirty =
      state.value.firstName !== userStore.currentUserDetails.firstName ||
      state.value.lastName !== userStore.currentUserDetails.lastName;

    const formValid = ProfileDetailsSchema.safeParse(state.value).success;

    const formSubmitting = uiStore.isRequestPending('editProfileDetails');

    return formDirty && formValid && !formSubmitting;
  });

  async function onSubmit(): Promise<void> {
    uiStore.setRequestPending('editProfileDetails');

    try {
      await $api.users.updateUser(userStore.currentUserDetails.id!, {
        FirstName: state.value.firstName,
        LastName: state.value.lastName,
      });

      useToastStore().success('Your Profile has been updated');

      // refresh auth session to get updated user details
      await useAuth().getRefreshedToken();
      await useUser().setCurrentUserDataFromToken();

      state.value = {
        firstName: userStore.currentUserDetails.firstName || '',
        lastName: userStore.currentUserDetails.lastName || '',
      };
    } catch (e) {
      console.error('error while updating user details:', e);
      useToastStore().error('Error updating user details');
    }

    uiStore.setRequestComplete('editProfileDetails');
  }
</script>

<template>
  <div class="mx-auto mt-24 w-[408px]">
    <EGPageHeader title="Edit Your Profile" :show-back="false" />

    <div class="border-stroke-light mb-12 flex flex-row items-center gap-3 rounded border bg-white p-4">
      <EGUserDisplay
        :initials="userStore.currentUserInitials"
        :name="userStore.currentUserDisplayName"
        :email="userStore.currentUserDetails.email"
      />
    </div>

    <UForm :schema="ProfileDetailsSchema" :state="state" @submit="onSubmit" aria-label="Edit profile details">
      <EGFormGroup label="First Name" name="firstName" eager-validation required>
        <EGInput v-model="state.firstName" required :disabled="uiStore.isRequestPending('editProfileDetails')" />
      </EGFormGroup>

      <EGFormGroup label="Last Name" name="lastName" eager-validation required>
        <EGInput v-model="state.lastName" required :disabled="uiStore.isRequestPending('editProfileDetails')" />
      </EGFormGroup>

      <div class="flex flex-row items-center justify-between">
        <NuxtLink to="/forgot-password" class="text-primary underline">Reset password</NuxtLink>
        <EGButton type="submit" label="Save Changes" :disabled="!allowSubmit" />
      </div>
    </UForm>

    <div v-if="showAnalyticsControl" class="border-stroke-light mt-12 rounded border bg-white p-4">
      <div class="flex flex-row items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
          <EGText tag="h4" class="font-semibold">Privacy</EGText>
          <EGText tag="p" class="text-muted text-sm">
            Send anonymous usage data to DEPT to help improve Easy Genomics. No names, emails, file names, sample data
            or run parameters are ever sent.
            <a href="https://easy-genomics.org/privacy" class="text-primary underline" target="_blank" rel="noopener">
              Learn more
            </a>
          </EGText>
          <EGText v-if="analyticsForceDisabled" tag="p" class="text-muted text-xs">
            Analytics is currently disabled by your browser's privacy settings or the environment.
          </EGText>
        </div>
        <UToggle
          :model-value="analyticsConsentGranted"
          :disabled="analyticsForceDisabled || analyticsUpdating"
          aria-label="Share anonymous usage analytics"
          @update:model-value="onToggleAnalytics"
        />
      </div>
    </div>
  </div>
</template>
