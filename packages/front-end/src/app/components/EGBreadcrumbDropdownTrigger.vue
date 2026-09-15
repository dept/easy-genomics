<script setup lang="ts">
  /**
   * Focusable trigger for lab/org breadcrumb UDropdowns.
   * Uses a span (not button) to avoid nested interactive controls inside Headless UI's
   * MenuButton wrapper, with tabindex so keyboard users can still reach it.
   */
  withDefaults(
    defineProps<{
      label: string;
      ariaLabel: string;
      showChevron?: boolean;
    }>(),
    {
      showChevron: false,
    },
  );

  /** Activate via synthetic click so Headless MenuButton's click handler opens the menu. */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).click();
  }
</script>

<template>
  <span
    tabindex="0"
    class="font-schibsted text-body focus-visible:ring-primary-500 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
  >
    {{ label }}
    <UIcon v-if="showChevron" name="i-heroicons-chevron-up-down" class="h-4 w-4 shrink-0" aria-hidden="true" />
  </span>
</template>
