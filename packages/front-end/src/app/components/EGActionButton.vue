<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      items: { name: string; icon: string; action: () => void }[];
      menuLabel?: string;
      /** Narrower menu + tighter item padding (e.g. lab Storage row actions). */
      compact?: boolean;
    }>(),
    {
      items: () => [],
      menuLabel: 'Actions',
      compact: false,
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
    :class="{ 'EGActionButton--compact': compact }"
    v-model:open="isOpen"
    :items="items"
    :popper="{ placement: 'bottom-end', strategy: 'fixed' }"
    :ui="{
      container: 'z-50 group',
      width: compact ? 'w-48' : 'w-72',
      item: {
        base: 'group flex items-start gap-2 w-full text-left',
        padding: compact ? 'py-1.5 px-3' : 'py-2.5 pl-3 pr-6',
        // Compact: gray hover only — leave text color to the label / is-highlighted styles.
        active: compact ? 'bg-background-light-grey' : 'bg-primary-muted text-primary',
        inactive: 'text-body',
        icon: {
          active: compact ? 'text-body' : 'text-primary',
          inactive: compact ? 'text-body' : 'text-primary',
        },
      },
    }"
    v-bind="attrs"
  >
    <!-- span + tabindex avoids nested <button> inside Headless MenuButton while remaining keyboard-reachable -->
    <span
      tabindex="0"
      class="hover:bg-primary-muted/60 focus-visible:ring-primary-500 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-300 bg-white text-black transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="{ 'EGActionButton__trigger--open': isOpen }"
      :aria-label="menuLabel"
      @keydown="onTriggerKeydown"
    >
      <UIcon name="i-heroicons-ellipsis-horizontal-20-solid" class="h-5 w-5" aria-hidden="true" />
    </span>
    <template #item="{ item }">
      <span class="flex w-full items-start gap-2.5" :class="{ 'is-highlighted': item.isHighlighted }">
        <UIcon
          v-if="item.icon"
          :name="item.icon"
          class="EGActionButton__icon mt-0.5 h-5 w-5 shrink-0"
          aria-hidden="true"
        />
        <UIcon
          v-else-if="item.isHighlighted && !item.hideIcon"
          name="i-heroicons-exclamation-triangle"
          class="mt-0.5 h-5 w-5 shrink-0"
          aria-hidden="true"
        />
        <span class="flex min-w-0 flex-col gap-0.5">
          <span
            class="EGActionButton__label text-sm leading-5"
            :class="compact ? 'font-normal' : 'font-medium'"
          >
            {{ item.label }}
          </span>
          <span v-if="item.description" class="EGActionButton__description text-xs font-normal leading-4">
            {{ item.description }}
          </span>
        </span>
      </span>
    </template>
  </UDropdown>
</template>

<style lang="scss">
  .EGActionButton {
    .p-1 {
      padding: 8px 12px;
    }

    &__trigger--open {
      background-color: #eee9fc; // primary-muted
      border-color: transparent;
    }

    &__icon {
      color: #5524e0; // primary
    }

    &__description {
      color: #666666; // muted — keep gray even when the parent item is text-primary
    }

    /* Hover/focus: purple title; description stays muted. */
    &:not(.EGActionButton--compact) {
      button:hover:not(:has(.is-highlighted)) .EGActionButton__label,
      button:focus:not(:has(.is-highlighted)) .EGActionButton__label,
      a:hover:not(:has(.is-highlighted)) .EGActionButton__label,
      a:focus:not(:has(.is-highlighted)) .EGActionButton__label {
        color: #5524e0;
      }

      /* Destructive item: light red wash on hover instead of purple. */
      button:has(.is-highlighted):hover,
      button:has(.is-highlighted):focus,
      a:has(.is-highlighted):hover,
      a:has(.is-highlighted):focus {
        background-color: #fdefec !important; // alert-danger-muted
        color: #ef5c45 !important;
      }

      .is-highlighted {
        font-weight: 500;
      }
    }

    .is-highlighted {
      color: #ef5c45; // alert-danger

      .EGActionButton__icon,
      .EGActionButton__label {
        color: #ef5c45;
      }

      .EGActionButton__description {
        color: #666666;
      }
    }

    /* Compact (lab Storage): gray hover only — no purple/red wash, no weight change. */
    &--compact {
      button:hover,
      button:focus,
      a:hover,
      a:focus {
        background-color: #efefef !important;
        color: inherit !important;
      }

      button:hover .EGActionButton__label,
      button:focus .EGActionButton__label,
      a:hover .EGActionButton__label,
      a:focus .EGActionButton__label {
        color: inherit;
      }

      button:has(.is-highlighted):hover .EGActionButton__label,
      button:has(.is-highlighted):focus .EGActionButton__label,
      a:has(.is-highlighted):hover .EGActionButton__label,
      a:has(.is-highlighted):focus .EGActionButton__label {
        color: #ef5c45;
      }
    }
  }
</style>
