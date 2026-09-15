<script setup lang="ts">
  withDefaults(
    defineProps<{
      items: { name: string; icon: string; action: () => void }[];
      menuLabel?: string;
    }>(),
    {
      items: () => [],
      menuLabel: 'Actions',
    },
  );
  const isOpen = ref(false);
  const attrs = useAttrs();

  /** Activate via synthetic click so Headless MenuButton's click handler opens the menu. */
  function onTriggerKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).click();
  }
</script>

<template>
  <UDropdown
    class="EGActionButton"
    v-model:open="isOpen"
    :items="items"
    :popper="{ placement: 'bottom-start' }"
    v-bind="attrs"
  >
    <!-- span + tabindex avoids nested <button> inside Headless MenuButton while remaining keyboard-reachable -->
    <span
      tabindex="0"
      class="hover:bg-null focus-visible:ring-primary-500 inline-flex h-10 w-10 items-center justify-center rounded-full border text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="{ active: isOpen }"
      :aria-label="menuLabel"
      @keydown="onTriggerKeydown"
    >
      <UIcon name="i-heroicons-ellipsis-horizontal-20-solid" class="h-5 w-5" aria-hidden="true" />
    </span>
    <template #item="{ item }">
      <span class="flex items-center gap-2 truncate" :class="{ 'is-highlighted': item.isHighlighted }">
        <UIcon
          v-if="item.isHighlighted"
          name="i-heroicons-exclamation-triangle"
          class="h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        {{ item.label }}
      </span>
    </template>
  </UDropdown>
</template>

<style lang="scss">
  .EGActionButton {
    .p-1 {
      padding: 8px 12px;
    }
  }

  .is-highlighted {
    color: #ef5c45;
    font-weight: 500;
  }

  .active {
    border-radius: 100px;
    background-color: #c2c2c2;
  }
</style>
