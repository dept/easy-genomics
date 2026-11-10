<script setup lang="ts">
  export interface DetailTabItem {
    key: string;
    label: string;
    /** Optional count shown after the label (e.g. All files 67). */
    count?: number | null;
    disabled?: boolean;
  }

  withDefaults(
    defineProps<{
      items: DetailTabItem[];
      modelValue: number;
      ariaLabel?: string;
    }>(),
    {
      ariaLabel: 'Page sections',
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();

  // The sliding marker is Nuxt UI's pill highlight. Hide it; the active tab's bottom border is the indicator.
  const EGTabsStyles = {
    base: 'focus-visible:outline-none',
    list: {
      base: '!flex gap-6 rounded-none mb-6 mt-0',
      background: '!bg-transparent',
      rounded: '!rounded-none',
      shadow: '!shadow-none',
      padding: '!p-0',
      height: '!h-auto',
      marker: {
        wrapper: '!hidden',
        base: '!hidden',
        background: '!bg-transparent',
        rounded: '!rounded-none',
        shadow: '!shadow-none',
      },
      tab: {
        base: '!w-auto border-b-2 border-solid -mb-px font-serif focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        background: '!bg-transparent',
        active: '!text-primary !border-primary',
        inactive: '!text-muted !border-transparent',
        height: '!h-auto',
        padding: '!px-0 !pt-1 !pb-2',
        size: 'text-sm',
        font: 'font-medium',
        rounded: '!rounded-none',
        shadow: '!shadow-none',
      },
    },
  };

  function panelId(key: string) {
    return `detail-panel-${key}`;
  }

  function tabId(key: string) {
    return `detail-tab-${key}`;
  }
</script>

<template>
  <UTabs
    :items="items"
    :ui="EGTabsStyles"
    :model-value="modelValue"
    :aria-label="ariaLabel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #default="{ item, selected }">
      <span class="whitespace-nowrap">
        {{ item.label }}
        <span v-if="item.count != null" class="ml-1.5 tabular-nums">{{ item.count.toLocaleString() }}</span>
      </span>
      <span v-if="selected" class="sr-only">, current tab</span>
    </template>

    <template #item="{ item }">
      <div
        role="tabpanel"
        :id="panelId(item.key)"
        :aria-labelledby="tabId(item.key)"
        tabindex="0"
        class="outline-none focus:outline-none"
      >
        <slot :item="item" />
      </div>
    </template>
  </UTabs>
</template>
