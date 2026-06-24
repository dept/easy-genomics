<script setup lang="ts">
  export interface WizardStepItem {
    key: string;
    label: string;
    disabled?: boolean;
  }

  const props = withDefaults(
    defineProps<{
      items: WizardStepItem[];
      modelValue: number;
      hasLaunched?: boolean;
      ariaLabel?: string;
    }>(),
    {
      hasLaunched: false,
      ariaLabel: 'Run wizard steps',
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();

  /**
   * Tab styles must live in this SFC so Tailwind includes the utility classes.
   * Duplicate changes to EGDetailTabs.vue and any page-local EGTabsStyles.
   */
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
        disabled: 'cursor-not-allowed opacity-50',
      },
    },
  };

  function isStepComplete(index: number) {
    return props.modelValue > index || props.hasLaunched;
  }

  function tabId(key: string) {
    return `wizard-tab-${key}`;
  }

  function panelId(key: string) {
    return `wizard-panel-${key}`;
  }

  watch(
    () => props.modelValue,
    () => {
      nextTick(() => {
        const activeKey = props.items[props.modelValue]?.key;
        if (!activeKey) return;
        const panel = document.getElementById(panelId(activeKey));
        panel?.focus();
      });
    },
  );
</script>

<template>
  <UTabs
    :items="items"
    :ui="EGTabsStyles"
    :model-value="modelValue"
    :aria-label="ariaLabel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #default="{ item, index, selected }">
      <div class="relative flex items-center gap-2 truncate">
        <UIcon
          v-if="isStepComplete(index)"
          name="i-heroicons-check-20-solid"
          class="text-primary h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        <span :class="isStepComplete(index) ? 'text-primary font-medium' : ''">{{ item.label }}</span>
        <span v-if="selected" class="sr-only">, current step</span>
        <span v-else-if="isStepComplete(index)" class="sr-only">, completed</span>
      </div>
    </template>

    <template #item="{ item, index, selected }">
      <div
        role="tabpanel"
        :id="panelId(item.key)"
        :aria-labelledby="tabId(item.key)"
        tabindex="0"
        class="outline-none focus:outline-none"
      >
        <slot name="panel" :item="item" :index="index" :selected="selected" />
      </div>
    </template>
  </UTabs>
</template>
