<script setup lang="ts">
  import { ProfileDetails, ProfileDetailsSchema } from '@FE/types/user';

  const { $api } = useNuxtApp();
  const userStore = useUserStore();
  const uiStore = useUiStore();

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
  </div>
</template>
