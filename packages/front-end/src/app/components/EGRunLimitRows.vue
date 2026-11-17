<script setup lang="ts">
  import type { RunLimitReview } from '@FE/utils/run-limit-review';

  defineProps<{
    review: RunLimitReview;
  }>();
</script>

<template>
  <div v-if="review.samplesRow" class="text-md flex border-b px-4 py-4">
    <dt class="w-48 shrink-0 text-black">Samples</dt>
    <dd class="text-muted min-w-0 flex-1 break-words text-left">
      <span v-if="review.samplesRow.countText">{{ review.samplesRow.countText }}</span>
      <span class="text-muted text-sm" :class="{ 'ml-2': review.samplesRow.countText }">
        {{ review.samplesRow.limitText }}
      </span>
    </dd>
  </div>
  <div v-if="review.notEnoughHistoryText" class="text-md flex border-b px-4 py-4">
    <dt class="w-48 shrink-0 text-black">Estimated cost</dt>
    <dd class="text-muted min-w-0 flex-1 break-words text-left">
      Not enough runs to estimate
      <span class="text-muted text-sm">{{ review.notEnoughHistoryText }}</span>
    </dd>
  </div>
</template>
