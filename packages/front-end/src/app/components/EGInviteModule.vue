<script setup lang="ts">
  import { z } from 'zod';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';

  const props = withDefaults(
    defineProps<{
      placeholder?: string;
      disabled?: boolean;
      orgId: string;
    }>(),
    {
      placeholder: 'Enter email address',
      disabled: false,
    },
  );

  const $emit = defineEmits(['invite-success']);
  const formSchema = z.object({
    email: z.string().email(VALIDATION_MESSAGES.email),
  });
  const isFormDisabled = ref(true);
  const state = ref({ email: '' });
  const { invite } = useUser();
  const emailInputId = useId();

  async function onSubmit() {
    try {
      useUiStore().setRequestPending('sendInvite');
      await invite({
        Email: state.value.email,
        OrganizationId: props.orgId,
      });
      state.value.email = '';
      $emit('invite-success');
    } catch (error) {
      console.error('Failed to send invitation:', error);
      useToastStore().error('Failed to send invitation. Please try again.');
    } finally {
      useUiStore().setRequestComplete('sendInvite');
    }
  }

  watchEffect(() => {
    isFormDisabled.value = !formSchema.safeParse(state.value).success;
  });
</script>

<template>
  <EGCard :padding="4">
    <UForm :schema="formSchema" :state="state" @submit="onSubmit">
      <div class="flex w-full items-center justify-center space-x-2">
        <div class="w-full grow">
          <label :for="emailInputId" class="sr-only">Email address</label>
          <EGInput
            :id="emailInputId"
            v-model="state.email"
            name="inviteEmail"
            type="email"
            autocomplete="email"
            :placeholder="placeholder"
            :clearable="true"
            :disabled="disabled"
          />
        </div>
        <EGButton
          label="Invite"
          type="submit"
          :disabled="isFormDisabled || useUiStore().isRequestPending('sendInvite')"
          icon="i-heroicons-envelope"
          :loading="useUiStore().isRequestPending('sendInvite')"
        />
      </div>
    </UForm>
  </EGCard>
</template>
