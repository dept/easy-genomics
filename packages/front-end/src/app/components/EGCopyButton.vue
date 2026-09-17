<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      value: string;
      /** Announced to screen readers, e.g. 'Copy internal run ID'. */
      label: string;
      feedbackMs?: number;
    }>(),
    { feedbackMs: 2000 },
  );

  const copied = ref(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    if (!props.value) return;

    try {
      await navigator.clipboard.writeText(props.value);
      copied.value = true;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copied.value = false), props.feedbackMs);
    } catch (error) {
      // Clipboard access is denied in some browser/permission combinations. The
      // value stays selectable on the page, so a failed copy is not worth a toast.
      console.error(`Failed to copy ${props.label}:`, error);
    }
  }

  onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <button
    type="button"
    class="text-muted inline-flex shrink-0 items-center rounded p-1 hover:text-black"
    :aria-label="label"
    @click="copy"
  >
    <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-square-2-stack'" class="h-4 w-4" />
    <span class="sr-only" role="status">{{ copied ? 'Copied' : '' }}</span>
  </button>
</template>
