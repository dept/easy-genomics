<script setup lang="ts">
  import { ButtonVariantEnum, ButtonSizeEnum } from '@FE/types/buttons';

  const props = defineProps<{
    modelValue: any;
    primaryMessage?: string;
    secondaryMessage?: string;
    actionLabel: string;
    actionVariant: string;
    cancelLabel?: string;
    cancelVariant?: string;
    buttonsDisabled?: boolean;
    loading?: boolean;
  }>();

  const emit = defineEmits(['action-triggered', 'update:modelValue']);

  function handleCancel() {
    emit('update:modelValue', false);
  }

  function handleClick() {
    emit('action-triggered');
  }
</script>

<template>
  <UModal
    :ui="{
      overlay: {
        base: 'fixed inset-0 transition-opacity backdrop-blur-[5px]',
        background: 'bg-gray-800/30',
      },
      rounded: 'rounded-3xl',
      width: 'sm:max-w-2xl',
    }"
    :modelValue="modelValue"
    @update:modelValue="(value) => emit('update:modelValue', value)"
    prevent-close
  >
    <UCard
      :ui="{
        base: 'p-10',
        rounded: 'rounded-3xl',
        header: {
          padding: '',
        },
      }"
    >
      <template #header>
        <div class="flex flex-col">
          <div class="flex items-start gap-2">
            <EGText tag="h3" class="mb-6 min-w-0 flex-1 break-all">{{ primaryMessage }}</EGText>
            <div class="shrink-0">
              <UButton
                @click="handleCancel"
                icon="i-heroicons-x-mark"
                class="hover:bg-background-dark-grey ml-2"
                color="black"
                variant="ghost"
                :ui="{ rounded: 'rounded-full' }"
                :disabled="buttonsDisabled || loading"
              />
            </div>
          </div>
          <div v-if="secondaryMessage">
            <EGText tag="p" class="mb-6 whitespace-pre-line break-words">{{ secondaryMessage }}</EGText>
          </div>
          <div class="flex justify-end gap-4">
            <div v-if="cancelLabel">
              <EGButton
                @click="handleCancel"
                :label="cancelLabel"
                :variant="ButtonVariantEnum.enum.secondary"
                :size="ButtonSizeEnum.enum.sm"
                :disabled="buttonsDisabled || loading"
              />
            </div>
            <EGButton
              @click="handleClick"
              :label="actionLabel"
              :size="ButtonSizeEnum.enum.sm"
              :variant="actionVariant"
              :disabled="buttonsDisabled || loading"
              :loading="loading"
              autofocus
            />
          </div>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
