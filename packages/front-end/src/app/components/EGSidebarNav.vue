<script setup lang="ts">
  export interface SidebarNavItem {
    key: string;
    label: string;
    icon?: string;
    dividerBefore?: boolean;
  }

  const props = withDefaults(
    defineProps<{
      items: SidebarNavItem[];
      modelValue: number;
      ariaLabel?: string;
      /** Visual treatment of the sidebar. Use 'dark' for org-admin areas to differentiate them from the light lab workspace. */
      variant?: 'light' | 'dark';
      /** Optional callout heading shown above the nav (e.g. "Admin view"). */
      calloutTitle?: string;
      /** Optional callout body shown beneath the callout title. */
      calloutDescription?: string;
      /** Icon shown inside the callout badge. */
      calloutIcon?: string;
    }>(),
    {
      ariaLabel: 'Section navigation',
      variant: 'light',
      calloutIcon: 'i-heroicons-building-office-2',
    },
  );

  const emit = defineEmits<{
    'update:modelValue': [index: number];
  }>();

  const uiStore = useUiStore();
  const isCollapsed = computed(() => uiStore.sidebarCollapsed);
  const isDark = computed(() => props.variant === 'dark');

  // Holds a reference to each tab button so keyboard navigation can move focus
  // between them (required by the ARIA tabs pattern / roving tabindex).
  const tabRefs = ref<(HTMLButtonElement | null)[]>([]);

  function setTabRef(el: Element | null, index: number) {
    tabRefs.value[index] = (el as HTMLButtonElement) ?? null;
  }

  function tabId(key: string) {
    return `tab-${key}`;
  }

  function panelId(key: string) {
    return `panel-${key}`;
  }

  function select(index: number) {
    emit('update:modelValue', index);
  }

  function focusTab(index: number) {
    nextTick(() => {
      tabRefs.value[index]?.focus();
    });
  }

  function focusPanel(index: number) {
    const key = props.items[index]?.key;
    if (!key) return;
    nextTick(() => {
      document.getElementById(panelId(key))?.focus();
    });
  }

  function onTabClick(index: number) {
    select(index);
    focusPanel(index);
  }

  function toggleCollapsed() {
    uiStore.toggleSidebarCollapsed();
  }

  // WAI-ARIA tabs with automatic activation: arrow keys move between tabs (wrapping),
  // Home/End jump to first/last. Click moves focus into the matching panel.
  function onKeydown(event: KeyboardEvent, index: number) {
    const lastIndex = props.items.length - 1;
    if (lastIndex < 0) return;

    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = index === lastIndex ? 0 : index + 1;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = index === 0 ? lastIndex : index - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = lastIndex;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextIndex !== props.modelValue) {
      select(nextIndex);
    }
    focusTab(nextIndex);
  }

  const tabButtonClass = (index: number) =>
    isDark.value
      ? [props.modelValue === index ? 'sidebar-tab--dark-active font-semibold' : 'sidebar-tab--dark']
      : [
          props.modelValue === index
            ? 'bg-primary-muted text-primary-dark font-semibold'
            : 'text-body hover:bg-background-light-grey',
        ];
</script>

<template>
  <nav
    class="sidebar-nav"
    :class="[isDark ? 'sidebar-nav--dark' : 'bg-white', { 'sidebar-nav--collapsed': isCollapsed }]"
    :aria-label="ariaLabel"
  >
    <button
      type="button"
      class="sidebar-nav__toggle focus-visible:outline-primary-500 flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      :class="[
        isDark ? 'text-[#c5c4d0] hover:bg-white/10' : 'text-body hover:bg-background-light-grey',
        isCollapsed ? 'sidebar-nav__toggle--collapsed' : 'sidebar-nav__toggle--expanded',
      ]"
      :aria-label="isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      :aria-expanded="!isCollapsed"
      @click="toggleCollapsed"
    >
      <UIcon
        :name="isCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-left'"
        class="h-5 w-5"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="calloutTitle"
      class="sidebar-callout mb-6 flex items-start gap-3 rounded-lg p-3"
      :class="{ 'sidebar-callout--collapsed justify-center p-2': isCollapsed }"
      role="note"
    >
      <span class="sidebar-callout__badge flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
        <UIcon :name="calloutIcon" class="h-4 w-4" aria-hidden="true" />
      </span>
      <span class="flex flex-col gap-1" :class="{ 'sr-only': isCollapsed }">
        <span class="sidebar-callout__title font-serif text-sm font-semibold">{{ calloutTitle }}</span>
        <span v-if="calloutDescription" class="sidebar-callout__description font-serif text-xs leading-snug">
          {{ calloutDescription }}
        </span>
      </span>
    </div>

    <div role="tablist" aria-orientation="vertical" class="flex flex-col">
      <template v-for="(item, index) in items" :key="item.key">
        <div
          v-if="item.dividerBefore"
          class="border-t"
          :class="[isCollapsed ? 'my-2' : 'my-3', isDark ? 'border-white/10' : 'border-background-dark-grey']"
          role="presentation"
        />
        <UTooltip v-if="isCollapsed" :open-delay="400">
          <template #text>{{ item.label }}</template>
          <button
            :ref="(el) => setTabRef(el, index)"
            type="button"
            role="tab"
            :id="tabId(item.key)"
            :aria-controls="panelId(item.key)"
            :aria-selected="modelValue === index"
            :tabindex="modelValue === index ? 0 : -1"
            @click="onTabClick(index)"
            @keydown="onKeydown($event, index)"
            class="focus-visible:outline-primary-500 flex w-full items-center justify-center rounded-lg px-2 py-2.5 font-serif text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="tabButtonClass(index)"
          >
            <UIcon v-if="item.icon" :name="item.icon" class="h-5 w-5 shrink-0" aria-hidden="true" />
            <span class="sr-only">{{ item.label }}</span>
          </button>
        </UTooltip>
        <button
          v-else
          :ref="(el) => setTabRef(el, index)"
          type="button"
          role="tab"
          :id="tabId(item.key)"
          :aria-controls="panelId(item.key)"
          :aria-selected="modelValue === index"
          :tabindex="modelValue === index ? 0 : -1"
          @click="onTabClick(index)"
          @keydown="onKeydown($event, index)"
          class="focus-visible:outline-primary-500 flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left font-serif text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="tabButtonClass(index)"
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
    left: calc(-1 * var(--sidebar-width) - var(--sidebar-content-gap));
    top: -1.5rem;
    bottom: 0;
    width: var(--sidebar-width);
    padding: 2rem 2rem 1rem;
    min-height: calc(100vh - var(--header-height));
    border-right: 1px solid #e5e5e5;
    border-top: 1px solid #e5e5e5;
    transition:
      width 0.2s ease,
      left 0.2s ease,
      padding 0.2s ease;

    &--collapsed {
      left: calc(-1 * var(--sidebar-width-collapsed) - var(--sidebar-content-gap));
      width: var(--sidebar-width-collapsed);
      padding: 1rem 0.5rem;
    }
  }

  .sidebar-nav__toggle {
    &--expanded {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 1;
    }

    &--collapsed {
      margin: 0 auto 1rem;
    }
  }

  // Dark treatment used by the org-admin area to read as a distinct place from the light lab workspace.
  .sidebar-nav--dark {
    background-color: #1b1a29;
    border-right-color: #1b1a29;
    border-top-color: #1b1a29;
  }

  .sidebar-callout {
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);

    &__badge {
      background-color: #5524e0; // primary
      color: #ffffff;
    }

    &__title {
      color: #ffffff;
    }

    &__description {
      color: #9b9aa8;
    }
  }

  .sidebar-tab--dark {
    color: #c5c4d0;

    &:hover {
      background-color: rgba(255, 255, 255, 0.06);
    }
  }

  .sidebar-tab--dark-active {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: #9687fe; // primaryCol-400
    color: #ffffff;
  }
</style>
