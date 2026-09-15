<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      placeholder: string;
      label?: string;
      disabled?: boolean;
    }>(),
    {
      placeholder: 'Search',
      disabled: false,
    },
  );

  const searchTerm = ref('');
  const inputId = useId();
  const accessibleLabel = computed(() => props.label ?? props.placeholder);

  const emit = defineEmits<{
    (event: 'input-event', data: string): void;
  }>();

  watch(searchTerm, (newValue) => {
    emit('input-event', newValue);
  });
</script>

<template>
  <div>
    <label :for="inputId" class="sr-only">{{ accessibleLabel }}</label>
    <UInput
      :id="inputId"
      v-model="searchTerm"
      name="searchTerm"
      :placeholder="placeholder"
      :disabled="disabled"
      icon="i-heroicons-magnifying-glass-20-solid"
      autocomplete="off"
      :trailing="true"
      :ui="{
        placeholder: 'placeholder-text-muted',
        base: 'focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
        icon: {
          base: 'text-neutral-black w-[24px] h-[24px] ',
        },
        padding: {
          sm: 'px-5 py-4',
        },
        color: {
          white: {
            outline: 'shadow-none focus-visible:ring-2 focus-visible:ring-primary-500',
          },
        },
      }"
    />
  </div>
</template>

<style scoped lang="scss"></style>
