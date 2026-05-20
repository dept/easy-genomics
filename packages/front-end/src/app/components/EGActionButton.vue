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
</script>

<template>
  <UDropdown
    class="EGActionButton"
    v-model:open="isOpen"
    :items="items"
    :popper="{ placement: 'bottom-start' }"
    v-bind="attrs"
  >
    <div class="h-10 w-10 rounded-full border">
      <UButton
        :class="{ active: isOpen }"
        class="hover:bg-null h-full w-full justify-center text-black"
        variant="ghost"
        icon="i-heroicons-ellipsis-horizontal-20-solid"
        :aria-label="menuLabel"
        :aria-expanded="isOpen"
        aria-haspopup="menu"
      />
    </div>
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
