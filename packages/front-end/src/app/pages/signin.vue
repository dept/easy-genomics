<script setup lang="ts">
  import { z } from 'zod';
  import { resetStores, useUiStore } from '@FE/stores';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';
  import { Auth } from 'aws-amplify';

  definePageMeta({ layout: 'signin' });

  const { signIn } = useAuth();
  const route = useRoute();
  const { GOOGLE_SIGNIN_ENABLED } = useRuntimeConfig().public;
  const isFormDisabled = ref(true);
  const isAcceptingInvite = !!route.query.email;
  const state = ref({
    email: route.query.email ? route.query.email.toString() : '',
    password: '',
  });
  const formSchema = z.object({
    email: z.string().email(VALIDATION_MESSAGES.email),
    password: z.string().min(1, VALIDATION_MESSAGES.password),
  });

  /**
   * @description Reset the stores to ensure app is in a clean state prior to sign in
   */
  onBeforeMount(() => {
    resetStores();
  });

  watchEffect(() => {
    isFormDisabled.value = !formSchema.safeParse(state.value).success;
  });

  async function signInWithGoogle() {
    await Auth.federatedSignIn({ provider: 'Google' });
  }
</script>

<template>
  <UForm :schema="formSchema" :state="state" @submit="signIn(state.email, state.password)" class="w-full max-w-[408px]">
    <EGText tag="h2" class="mb-12">Sign in</EGText>
    <template v-if="GOOGLE_SIGNIN_ENABLED">
      <EGButton
        variant="secondary"
        class="mb-8 gap-4"
        label="Sign in with Google"
        icon="logos:google-icon"
        u-button-type="button"
        :iconRight="false"
        :disabled="useUiStore().isRequestPending('signInWithGoogle')"
        :loading="useUiStore().isRequestPending('signInWithGoogle')"
        :ui="{
          base: 'w-full justify-start',
          label: 'font-normal',
        }"
        @click="signInWithGoogle"
      />
      <div class="my-6 flex items-center">
        <div class="flex-grow border-t border-gray-200" />
        <span class="mx-4 text-sm uppercase text-gray-400">OR</span>
        <div class="flex-grow border-t border-gray-200" />
      </div>
    </template>
    <EGFormGroup label="Email" name="email">
      <EGInput v-model="state.email" :autofocus="isAcceptingInvite" autocomplete="username" />
    </EGFormGroup>
    <EGFormGroup label="Password" name="password">
      <EGPasswordInput v-model="state.password" :autofocus="isAcceptingInvite" />
    </EGFormGroup>
    <div class="flex items-center justify-between">
      <EGButton
        :disabled="isFormDisabled || useUiStore().isRequestPending('signIn')"
        :loading="useUiStore().isRequestPending('signIn')"
        label="Sign in"
        u-button-type="submit"
      />
      <EGText href="/forgot-password" tag="a" color-class="text-primary">Forgot password?</EGText>
    </div>
  </UForm>
</template>
