<script setup lang="ts">
  export interface DetailTabItem {
    key: string;
    label: string;
    /** Optional count shown after the label (e.g. All files 67). */
    count?: number | null;
    disabled?: boolean;
  }

  const props = withDefaults(
    defineProps<{
      items: DetailTabItem[];
      modelValue: number;
      ariaLabel?: string;
      /** underline = legacy detail pages; pills = HealthOmics run overview redesign. */
      variant?: 'underline' | 'pills';
    }>(),
    {
      ariaLabel: 'Page sections',
      variant: 'underline',
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();

  // Underline styles must live in this SFC so Tailwind includes the utility classes.
  // Hide Nuxt UI's sliding marker; the active tab's bottom border is the indicator.
  const underlineTabsStyles = {
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

  const selectedItem = computed(() => props.items[props.modelValue] ?? props.items[0]);

  function panelId(key: string) {
    return `detail-panel-${key}`;
  }

  function tabId(key: string) {
    return `detail-tab-${key}`;
  }

  function selectTab(index: number) {
    if (props.items[index]?.disabled) return;
    emit('update:modelValue', index);
  }
</script>

<template>
  <!--
    Pills use a custom segmented control. Nuxt UI's UTabs marker/background merge
    left the active pill white-on-white; this matches the run-overview design.
  -->
  <div v-if="variant === 'pills'">
    <div
      class="stroke-light mb-6 inline-flex w-fit flex-wrap gap-1 rounded-xl border border-solid bg-white p-1"
      role="tablist"
      :aria-label="ariaLabel"
    >
      <button
        v-for="(item, index) in items"
        :id="tabId(item.key)"
        :key="item.key"
        type="button"
        role="tab"
        class="focus-visible:ring-primary-500 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          modelValue === index
            ? 'bg-primary text-white'
            : 'text-text-body hover:bg-background-light-grey bg-transparent'
        "
        :aria-selected="modelValue === index"
        :aria-controls="panelId(item.key)"
        :disabled="item.disabled"
        :tabindex="modelValue === index ? 0 : -1"
        @click="selectTab(index)"
      >
        <span class="whitespace-nowrap">{{ item.label }}</span>
        <span
          v-if="item.count != null"
          class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs tabular-nums"
          :class="modelValue === index ? 'bg-primary-400/50 text-white' : 'bg-background-light-grey text-text-body'"
        >
          {{ item.count.toLocaleString() }}
        </span>
        <span v-if="modelValue === index" class="sr-only">, current tab</span>
      </button>
    </div>

    <div
      v-if="selectedItem"
      role="tabpanel"
      :id="panelId(selectedItem.key)"
      :aria-labelledby="tabId(selectedItem.key)"
      tabindex="0"
      class="outline-none focus:outline-none"
    >
      <slot :item="selectedItem" />
    </div>
  </div>

  <UTabs
    v-else
    :items="items"
    :ui="underlineTabsStyles"
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
