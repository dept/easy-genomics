<script setup lang="ts">
  export interface SidebarNavItem {
    key: string;
    label: string;
    icon?: string;
    dividerBefore?: boolean;
  }

  withDefaults(
    defineProps<{
      items: SidebarNavItem[];
      modelValue: number;
      ariaLabel?: string;
    }>(),
    {
      ariaLabel: 'Section navigation',
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();

  function tabId(key: string) {
    return `tab-${key}`;
  }

  function panelId(key: string) {
    return `panel-${key}`;
  }
</script>

<template>
  <nav class="sidebar-nav bg-white" :aria-label="ariaLabel">
    <div role="tablist" aria-orientation="vertical" class="flex flex-col">
      <template v-for="(item, index) in items" :key="item.key">
        <div v-if="item.dividerBefore" class="border-background-dark-grey my-3 border-t" role="presentation" />
        <button
          type="button"
          role="tab"
          :id="tabId(item.key)"
          :aria-controls="panelId(item.key)"
          :aria-selected="modelValue === index"
          @click="emit('update:modelValue', index)"
          class="focus-visible:outline-primary-500 flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left font-serif text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="[
            modelValue === index
              ? 'bg-primary-muted text-primary-dark border-primary-dark border-l-2 pl-[14px] font-semibold'
              : 'text-body hover:bg-background-light-grey border-l-2 border-transparent pl-[14px]',
          ]"
        >
          <UIcon v-if="item.icon" :name="item.icon" class="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
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
