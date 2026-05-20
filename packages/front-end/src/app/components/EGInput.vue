<script setup lang="ts">
  defineOptions({ inheritAttrs: false });

  withDefaults(
    defineProps<{
      modelValue?: string | number;
      id?: string;
      name?: string;
      type?: string;
      placeholder?: string;
      disabled?: boolean;
      clearable?: boolean;
      autocomplete?: string;
    }>(),
    {
      placeholder: '',
      disabled: false,
      autocomplete: '',
      type: 'text',
    },
  );

  const attrs = useAttrs();

  function clear() {
    emit('update:modelValue', '');
  }

  const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <UInput
    v-bind="attrs"
    :id="id"
    :name="name"
    :type="type"
    :autocomplete="autocomplete"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :disabled="disabled"
    :ui="{
      icon: { trailing: { pointer: '' } },
      base: 'h-13 !shadow-none border-background-stroke-dark text-body bg-white disabled:text-muted disabled:bg-background-light-grey disabled:opacity-100',
      rounded: 'rounded-md',
      placeholder: 'text-muted',
      padding: {
        sm: 'p-4',
      },
    }"
    :placeholder="placeholder"
  >
    <template #trailing v-if="clearable">
      <UButton
        v-show="modelValue !== ''"
        color="black"
        variant="link"
        icon="i-heroicons-x-mark-20-solid"
        :padded="false"
        aria-label="Clear input"
        @click="clear"
      />
    </template>
  </UInput>
</template>

<style scoped lang="scss"></style>
