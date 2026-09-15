<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      disabled?: boolean;
      modelValue: string | undefined;
      placeholder?: string;
      options: any[];
    }>(),
    {
      disabled: false,
      options: [],
      placeholder: 'Select',
    },
  );

  const emit = defineEmits(['update:modelValue']);
  const internalModelValue = ref(props.modelValue);

  watch(
    () => props.modelValue,
    (newValue) => {
      internalModelValue.value = newValue;
    },
  );

  // Emit the update event when internalModelValue changes
  function updateModelValue(newValue: any) {
    // USelectMenu can return the full option object when options are objects.
    // Normalize to the `value` field so EGSelect consistently behaves like a string select.
    if (newValue && typeof newValue === 'object' && 'value' in newValue) {
      emit('update:modelValue', String(newValue.value));
      return;
    }
    emit('update:modelValue', newValue);
  }
</script>

<template>
  <USelectMenu
    :ui="{
      base: ' !shadow-none border-background-stroke-dark text-body bg-white disabled:text-muted disabled:bg-background-light-grey disabled:opacity-100',
      padding: {
        sm: 'p-4',
      },
    }"
    :uiMenu="{
      base: 'ml-0',
      option: {
        size: 'text-sm',
        active: 'bg-primary-muted !text-body',
        inactive: 'text-muted',
        selected: '!text-body',
        icon: {
          active: 'text-primary',
        },
        selectedIcon: {
          wrapper: 'absolute inset-y-0 end-0 flex items-center',
          padding: 'pe-2',
          base: 'h-5 w-5 text-primary',
        },
      },
      select: 'cursor-hand',
    }"
    :disabled="disabled"
    :options="options"
    :placeholder="placeholder"
    :searchable-placeholder="placeholder"
    :model-value="modelValue"
    @update:modelValue="updateModelValue"
    searchable
  />
</template>
