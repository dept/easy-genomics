<script setup lang="ts">
  defineProps<{
    /** Raw failure code or message as returned by the execution platform. */
    reason: string;
    /** Platform credited for the message, e.g. 'AWS HealthOmics'. */
    platform: string;
    /** Seqera returns a long free-text report alongside the reason; HealthOmics does not. */
    errorReport?: string | null;
  }>();
</script>

<template>
  <section class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5">
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Failure reason</h3>

    <p class="mb-3 flex items-center gap-2 text-sm text-black">
      <UIcon name="i-heroicons-exclamation-circle-solid" class="shrink-0 text-red-600" />
      Returned by {{ platform }}
    </p>

    <div class="overflow-x-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <code class="whitespace-pre-wrap break-words font-mono text-sm text-red-700">{{ reason }}</code>
    </div>

    <details v-if="errorReport" class="mt-3">
      <summary class="text-muted cursor-pointer text-xs">Show full error report</summary>
      <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-red-600">{{ errorReport }}</pre>
    </details>

    <!-- Interpretation of the raw code above. Kept visually separate: the code is
         what the platform reported, the analysis is inference about it. -->
    <div v-if="$slots.analysis" class="mt-5 border-t pt-4">
      <slot name="analysis" />
    </div>

    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </section>
</template>
