<script setup lang="ts">
  import type { RunLimitMessage } from '@FE/utils/run-limit-review';

  defineProps<{
    message: RunLimitMessage | null;
  }>();

  const TONE_CLASSES: Record<RunLimitMessage['tone'], string> = {
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    block: 'border-red-200 bg-red-50 text-red-800',
  };
</script>

<template>
  <div v-if="message" :role="message.role" class="rounded-lg border p-3 text-sm" :class="TONE_CLASSES[message.tone]">
    <p class="font-semibold">{{ message.title }}</p>
    <p class="mt-1">{{ message.body }}</p>
  </div>
</template>
