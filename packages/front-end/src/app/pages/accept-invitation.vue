<script setup lang="ts">
  import { z } from 'zod';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';
  import { ERROR_MESSAGES } from '@easy-genomics/shared-lib/src/app/constants/errorMessages';
  import { checkIsTokenExpired, decodeJwt } from '@FE/utils/jwt-utils';
  import { EmailSchema, NonEmptyStringSchema } from '@easy-genomics/shared-lib/src/app/types/base-unified';
  import { getUrlParamValue } from '@FE/utils/string-utils';

  definePageMeta({ layout: 'signin' });

  const isFormDisabled = ref(true);
  const router = useRouter();
  const state = ref({ email: '', firstName: '', lastName: '', password: '' });
  const { $api } = useNuxtApp();
  const { signIn } = useAuth();
  const formSchema = z.object({
    firstName: z
      .string()
      .min(1, VALIDATION_MESSAGES.notEmpty)
      .max(50, VALIDATION_MESSAGES.nameMaxLength)
      .refine((name) => /^[a-zA-Z0-9\s'.-]*$/.test(name), VALIDATION_MESSAGES.invalidChar)
      .refine((name) => !/\s{2,}/.test(name), VALIDATION_MESSAGES.nameMultiSpaces),
    lastName: z
      .string()
      .min(1, VALIDATION_MESSAGES.notEmpty)
      .max(50, VALIDATION_MESSAGES.nameMaxLength)
      .refine((name) => /^[a-zA-Z0-9\s'.-]*$/.test(name), VALIDATION_MESSAGES.invalidChar)
      .refine((name) => !/\s{2,}/.test(name), VALIDATION_MESSAGES.nameMultiSpaces),
    password: z
      .string()
      .nonempty(VALIDATION_MESSAGES.notEmpty)
      .min(8, VALIDATION_MESSAGES.passwordMinLength)
      .max(50, VALIDATION_MESSAGES.passwordMaxLength)
      .refine((value) => !/\s/.test(value), VALIDATION_MESSAGES.notSpaces)
      .refine((value) => /[A-Z]/.test(value), VALIDATION_MESSAGES.passwordUppercase)
      .refine((value) => /[a-z]/.test(value), VALIDATION_MESSAGES.passwordLowercase)
      .refine((value) => /[0-9]/.test(value), VALIDATION_MESSAGES.passwordNumber)
      .refine((value) => /[^a-zA-Z0-9]/.test(value), VALIDATION_MESSAGES.passwordSymbol),
  });
  const inviteToken = ref();

  /**
   * @description Check accept invite token is valid, otherwise redirect to the signin page
   */
  onMounted(() => {
    processToken();
  });

  function processToken() {
    try {
      const token = getUrlToken();
      const isTokenExpired = checkIsTokenExpired(token);

      if (isTokenExpired) {
        handleExpiredToken();
        return;
      } else {
        extractTokenValues(token);
      }
    } catch (error) {
      console.error('Error processing token; error:', error);
      useToastStore().error('Invalid or expired invitation link.');
      navigateTo('/signin');
    }
  }

  function extractTokenValues(token: string) {
    const email = getEmailFromToken(token);
    state.value.email = email;
    inviteToken.value = token;
  }

  function handleExpiredToken() {
    useToastStore().error(VALIDATION_MESSAGES.inviteAcceptedOrExpired);
    navigateTo('/signin');
  }

  function getUrlToken(): string {
    const token = getUrlParamValue('invite');
    const parseResult = NonEmptyStringSchema.safeParse(token);
    if (!parseResult.success) {
      throw new Error('Invalid invite token');
    }
    return parseResult.data;
  }

  function getEmailFromToken(token: string): string {
    const decodedToken = decodeJwt(token);
    const parseResult = EmailSchema.safeParse(decodedToken.Email);

    if (!parseResult.success) {
      console.error('Invalid email in token; parseResult', parseResult);
      throw new Error('Invalid email in token');
    }

    return parseResult.data;
  }

  function handleSuccess() {
    useToastStore().success(`Welcome to Easy Genomics!`);
  }

  /**
   * @description Create a new user account and sign user in
   */
  async function onSubmit() {
    const { email, firstName, lastName, password } = state.value;
    try {
      useUiStore().setRequestPending('acceptInvite');
      await $api.users.confirmUserInviteRequest(inviteToken.value, firstName, lastName, password);
      await signIn(email, password);
      handleSuccess();
    } catch (error: any) {
      if (error.message === `Request error: Unauthorized access: ${ERROR_MESSAGES.invitationAlreadyActivated}`) {
        await router.push({ path: `/signin`, query: { email: state.value.email } });
        useToastStore().error(VALIDATION_MESSAGES.inviteAcceptedOrExpired);
      } else {
        useToastStore().error(VALIDATION_MESSAGES.network);
        console.error('Error occurred during forgot password request.', error);
        throw error;
      }
    } finally {
      useUiStore().setRequestComplete('acceptInvite');
    }
  }

  watchEffect(() => {
    isFormDisabled.value = !formSchema.safeParse(state.value).success;
  });
</script>

<template>
  <UForm :schema="formSchema" :state="state" class="w-full max-w-[408px]">
    <EGText tag="h2" class="mb-12">Create Account</EGText>
    <EGFormGroup label="Email address" name="email">
      <EGInput v-model="state.email" :disabled="true" />
    </EGFormGroup>
    <EGFormGroup label="First Name" name="firstName">
      <EGInput v-model="state.firstName" :disabled="useUiStore().isRequestPending('acceptInvite')" />
    </EGFormGroup>
    <EGFormGroup label="Last Name" name="lastName">
      <EGInput v-model="state.lastName" :disabled="useUiStore().isRequestPending('acceptInvite')" />
    </EGFormGroup>
    <EGFormGroup label="Create password" name="password">
      <EGPasswordInput v-model="state.password" :disabled="useUiStore().isRequestPending('acceptInvite')" />
    </EGFormGroup>
    <div class="flex items-center justify-between">
      <EGButton
        :disabled="isFormDisabled || useUiStore().isRequestPending('acceptInvite')"
        :loading="useUiStore().isRequestPending('acceptInvite')"
        label="Complete setup & Sign In"
        @click="onSubmit()"
      />
    </div>
  </UForm>
</template>
