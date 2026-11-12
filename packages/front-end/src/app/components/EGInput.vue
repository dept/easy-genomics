<script setup lang="ts">
  defineOptions({ inheritAttrs: false });

  const props = withDefaults(
    defineProps<{
      modelValue?: string | number;
      id?: string;
      name?: string;
      type?: string;
      placeholder?: string;
      disabled?: boolean;
      clearable?: boolean;
      autocomplete?: string;
      /** Unit drawn inside the field, e.g. "months". */
      suffix?: string;
      /** Shorter control for a value plus a unit. */
      compact?: boolean;
    }>(),
    {
      placeholder: '',
      disabled: false,
      autocomplete: '',
      type: 'text',
      suffix: '',
      compact: false,
    },
  );

  const attrs = useAttrs();

  const inputUi = computed(() => ({
    icon: {
      trailing: {
        pointer: '',
        ...(props.suffix ? { wrapper: 'pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3' } : {}),
      },
    },
    ...(props.suffix ? { trailing: { padding: { sm: 'pe-20' } } } : {}),
    base: [
      '!shadow-none border-background-stroke-dark text-body bg-white disabled:text-muted disabled:bg-background-light-grey disabled:opacity-100',
      props.compact ? 'h-10' : 'h-13',
      props.compact
        ? '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        : '',
    ].join(' '),
    rounded: 'rounded-md',
    placeholder: 'text-muted',
    padding: {
      sm: props.compact ? 'px-3 py-2' : 'p-4',
    },
  }));

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
    :ui="inputUi"
    :placeholder="placeholder"
  >
    <template v-if="suffix || clearable" #trailing>
      <span v-if="suffix" class="text-muted text-sm">{{ suffix }}</span>
      <UButton
        v-if="clearable"
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
