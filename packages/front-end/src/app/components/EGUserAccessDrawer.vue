<script setup lang="ts">
  const props = defineProps<{
    modelValue: boolean;
    orgId: string;
    userId: string;
  }>();

  const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
  }>();

  function close() {
    emit('update:modelValue', false);
  }
</script>

<template>
  <USlideover
    :model-value="modelValue"
    side="right"
    :ui="{ width: 'w-screen max-w-xl' }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <UCard
      class="flex h-full flex-col"
      :ui="{
        body: { base: 'flex-1 overflow-y-auto' },
        rounded: 'rounded-none',
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Edit user access</h2>
          <EGButton
            u-button-type="button"
            variant="secondary"
            size="sm"
            icon="i-heroicons-x-mark"
            aria-label="Close"
            @click="close"
          />
        </div>
      </template>

      <EGUserAccessPanel v-if="modelValue" :org-id="orgId" :user-id="userId" />
    </UCard>
  </USlideover>
</template>
