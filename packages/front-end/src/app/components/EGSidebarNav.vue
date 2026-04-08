<script setup lang="ts">
  export interface SidebarNavItem {
    key: string;
    label: string;
    icon?: string;
    dividerBefore?: boolean;
  }

  defineProps<{
    items: SidebarNavItem[];
    modelValue: number;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();
</script>

<template>
  <nav class="sidebar-nav bg-white">
    <template v-for="(item, index) in items" :key="item.key">
      <div v-if="item.dividerBefore" class="border-background-dark-grey my-3 border-t" />
      <button
        @click="emit('update:modelValue', index)"
        class="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left font-serif text-sm transition-colors"
        :class="[
          modelValue === index
            ? 'bg-primary-muted text-primary-dark font-medium'
            : 'text-body hover:bg-background-light-grey',
        ]"
      >
        <UIcon v-if="item.icon" :name="item.icon" class="h-5 w-5 shrink-0" />
        <span>{{ item.label }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped lang="scss">
  .sidebar-nav {
    position: absolute;
    left: calc(-1 * var(--sidebar-width) - 2rem);
    top: -1.5rem;
    bottom: 0;
    width: var(--sidebar-width);
    padding: 2rem 2rem 1rem;
    min-height: calc(100vh - var(--header-height));
    border-right: 1px solid #e5e5e5;
    border-top: 1px solid #e5e5e5;
  }
</style>
