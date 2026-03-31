<script setup lang="ts">
  const props = defineProps<{
    modelValue: string;
    options: string[];
    description?: string;
    helpText?: string;
    disabled?: boolean;
  }>();

  const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <div>
    <EGText v-if="description" tag="small">{{ description }}</EGText>
    <EGSelect
      :model-value="modelValue"
      :options="options"
      :disabled="disabled"
      class="mt-1"
      @update:model-value="(val) => emit('update:modelValue', val)"
    />
    <EGText v-if="helpText" tag="small" color-class="text-muted">{{ helpText }}</EGText>
  </div>
</template>
