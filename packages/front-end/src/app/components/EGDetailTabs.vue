<script setup lang="ts">
  export interface DetailTabItem {
    key: string;
    label: string;
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

  const EGTabsStyles = {
    base: 'focus-visible:outline-none',
    list: {
      base: '!flex rounded-none mb-6 mt-0',
      padding: 'p-0',
      height: 'h-14',
      marker: {
        background: '',
        shadow: '',
      },
      tab: {
        base: 'font-serif w-auto mr-3 rounded-xl border border-solid focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        background: '',
        active: 'text-white bg-primary border-primary',
        inactive: 'font-serif text-text-body border-background-dark-grey',
        height: '',
        padding: 'px-5 py-2',
        size: 'text-sm',
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
      <span>{{ item.label }}</span>
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
