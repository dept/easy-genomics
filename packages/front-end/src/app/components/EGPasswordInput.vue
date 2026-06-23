<script setup lang="ts">
  import { AutoCompleteOption, AutoCompleteOptionsEnum } from '@FE/types/forms';

  /**
   * Props
   * @param {boolean} [password=true] - Whether the input should be a password input
   * @param {AutoCompleteOption} [autocomplete=AutoCompleteOptionsEnum.enum.CurrentPassword] - The autocomplete option for browser and password manager behaviour
   * @param {string} [placeholder=''] - The placeholder text for the input
   * @param {boolean} [disabled=false] - Whether the input should be disabled
   * @param {boolean} [showTogglePasswordButton=true] - Whether the input should have an icon to toggle visibility
   * @param {boolean} [selectOnFocus=false] - Whether the input should select all text on focus
   */
  const props = withDefaults(
    defineProps<{
      password?: boolean;
      autocomplete?: AutoCompleteOption;
      placeholder?: string;
      disabled?: boolean;
      showTogglePasswordButton?: boolean;
      selectOnFocus?: boolean;
    }>(),
    {
      password: true,
      autocomplete: AutoCompleteOptionsEnum.enum.CurrentPassword,
      placeholder: '',
      disabled: false,
      showTogglePasswordButton: true,
      selectOnFocus: false,
    },
  );

  const inputType = props.password ? ref('password') : ref('text');

  // Toggle the input field type between rendering the password as a series of • characters or as plain text
  function switchVisibility() {
    inputType.value = inputType.value === 'password' ? 'text' : 'password';
  }
</script>

<template>
  <UInput
    :autocomplete="autocomplete"
    @focus="selectOnFocus && $event.target.select()"
    :disabled="disabled"
    :ui="{
      icon: { trailing: { pointer: '' } },
      base: 'mt-2 h-12 !shadow-none border-background-stroke-dark !bg-white text-body disabled:bg-background-light-grey disabled:text-muted',
      rounded: 'rounded-md',
      placeholder: 'placeholder-text-muted',
      padding: {
        sm: 'p-4',
      },
    }"
    :type="inputType"
    :placeholder="placeholder"
  >
    <template v-if="showTogglePasswordButton" #trailing>
      <UButton
        color="black"
        variant="link"
        :padded="false"
        :icon="inputType === 'password' ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
        :aria-label="inputType === 'password' ? 'Show password' : 'Hide password'"
        :aria-pressed="inputType === 'text'"
        @click="switchVisibility"
      />
    </template>
  </UInput>
</template>

<style scoped lang="scss"></style>
