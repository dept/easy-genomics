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
      placeholder: 'Enter Email',
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
        <EGInput v-model="state.email" :placeholder="placeholder" :clearable="true" class="w-full" />
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
