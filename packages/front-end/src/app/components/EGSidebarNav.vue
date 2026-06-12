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
    tabRefs.value[index]?.focus();
  }

  // Implements the WAI-ARIA Authoring Practices "tabs with automatic activation"
  // keyboard interaction for a vertically-oriented tablist: Up/Down move between
  // tabs (wrapping), Home/End jump to the first/last tab. Moving focus also
  // selects the tab so the matching panel is revealed.
  function onKeydown(event: KeyboardEvent, index: number) {
    const lastIndex = props.items.length - 1;
    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowDown':
        nextIndex = index === lastIndex ? 0 : index + 1;
        break;
      case 'ArrowUp':
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
    select(nextIndex);
    focusTab(nextIndex);
  }
</script>

<template>
  <nav class="sidebar-nav" :class="isDark ? 'sidebar-nav--dark' : 'bg-white'" :aria-label="ariaLabel">
    <div v-if="calloutTitle" class="sidebar-callout mb-6 flex items-start gap-3 rounded-lg p-3" role="note">
      <span class="sidebar-callout__badge flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
        <UIcon :name="calloutIcon" class="h-4 w-4" aria-hidden="true" />
      </span>
      <span class="flex flex-col gap-1">
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
          class="my-3 border-t"
          :class="isDark ? 'border-white/10' : 'border-background-dark-grey'"
          role="presentation"
        />
        <button
          :ref="(el) => setTabRef(el, index)"
          type="button"
          role="tab"
          :id="tabId(item.key)"
          :aria-controls="panelId(item.key)"
          :aria-selected="modelValue === index"
          :tabindex="modelValue === index ? 0 : -1"
          @click="select(index)"
          @keydown="onKeydown($event, index)"
          class="focus-visible:outline-primary-500 flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left font-serif text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="
            isDark
              ? [modelValue === index ? 'sidebar-tab--dark-active font-semibold' : 'sidebar-tab--dark']
              : [
                  modelValue === index
                    ? 'bg-primary-muted text-primary-dark font-semibold'
                    : 'text-body hover:bg-background-light-grey',
                ]
          "
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
