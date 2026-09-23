<script setup lang="ts">
  import type { AnalysisHistoryEntry } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
  import { formatRelativeDateTime } from '@FE/utils/date-time';

  const props = defineProps<{ entries?: AnalysisHistoryEntry[]; runCount?: number }>();

  // Entry 0 is the answer already rendered above this component; showing it
  // again would read as a duplicate rather than as history.
  const previous = computed<AnalysisHistoryEntry[]>(() => props.entries?.slice(1) ?? []);
  const isOpen = ref(false);

  // Attempts can exceed stored answers two ways: a failed attempt writes no
  // entry, and the array stops growing at its ceiling. Showing the count
  // alongside the list keeps that difference visible instead of implying the
  // list is everything that happened.
  const runCountLabel = computed<string>(() => {
    const total = props.runCount ?? 0;
    const stored = props.entries?.length ?? 0;
    return total > stored ? `Run ${total} times · ${stored} answers kept` : `Run ${total} times`;
  });
</script>

<template>
  <div v-if="previous.length || (runCount ?? 0) > 1" class="mt-3">
    <p class="text-muted text-xs">{{ runCountLabel }}</p>

    <button
      v-if="previous.length"
      type="button"
      class="text-muted text-xs underline"
      @click="isOpen = !isOpen"
    >
      {{ isOpen ? 'Hide' : 'Show' }} {{ previous.length }} earlier
      {{ previous.length === 1 ? 'analysis' : 'analyses' }}
    </button>

    <ul v-if="isOpen" class="mt-2 space-y-3">
      <li v-for="entry in previous" :key="entry.AnalysedAt" class="border-l-2 border-gray-200 pl-3">
        <p class="text-muted text-xs">
          {{ formatRelativeDateTime(entry.AnalysedAt) }} · Owner: {{ entry.Owner }}
          <span v-if="entry.ModelId"> · {{ entry.ModelId }}</span>
          <span v-if="entry.Evidence === 'log-excerpt'"> · with run logs</span>
          <span v-else-if="entry.Evidence"> · without run logs</span>
        </p>
        <p class="text-sm text-black">{{ entry.Summary }}</p>
        <p class="text-muted text-sm">{{ entry.Action }}</p>
      </li>
    </ul>
  </div>
</template>
