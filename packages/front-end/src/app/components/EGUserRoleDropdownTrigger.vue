<script setup lang="ts">
  /**
   * Focusable trigger for lab-role UDropdowns.
   * Uses a span (not button) to avoid nested interactive controls inside Headless UI's
   * MenuButton wrapper, with tabindex so keyboard users can still reach it.
   */
  const props = withDefaults(
    defineProps<{
      roleLabel: string;
      ariaLabel: string;
      disabled?: boolean;
    }>(),
    {
      disabled: false,
    },
  );

  /** Activate via synthetic click so Headless MenuButton's click handler opens the menu. */
  function onKeydown(e: KeyboardEvent): void {
    if (props.disabled) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).click();
  }
</script>

<template>
  <span
    :tabindex="props.disabled ? -1 : 0"
    class="focus-visible:ring-primary-500 text-muted inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    :class="{ 'opacity-50': props.disabled }"
    :aria-label="props.ariaLabel"
    :aria-disabled="props.disabled || undefined"
    @keydown="onKeydown"
  >
    {{ props.roleLabel }}
    <UIcon name="i-heroicons-chevron-down" class="h-4 w-4 shrink-0" aria-hidden="true" />
  </span>
</template>
