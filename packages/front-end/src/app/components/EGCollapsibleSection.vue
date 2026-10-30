<script setup lang="ts">
  interface Badge {
    label: string;
    /** 'positive' reads as an active/on state; 'neutral' as inactive/off/disabled. */
    tone?: 'positive' | 'neutral';
  }

  const props = withDefaults(
    defineProps<{
      headingId: string;
      title: string;
      description?: string;
      /** Extra detail shown in a hover tooltip next to the description, e.g. why a feature exists. */
      descriptionTooltip?: string;
      badges?: Badge[];
      /** Compact status shown in the header (e.g. collapsed storage summary). */
      summary?: string;
      defaultOpen?: boolean;
      /** Controlled open state. When set, pair with `@update:open` (or `v-model:open`). */
      open?: boolean;
    }>(),
    {
      description: '',
      descriptionTooltip: '',
      badges: () => [],
      summary: '',
      defaultOpen: false,
    },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
  }>();

  const internalOpen = ref(props.defaultOpen);

  const isOpen = computed({
    get: () => (props.open !== undefined ? props.open : internalOpen.value),
    set: (value: boolean) => {
      internalOpen.value = value;
      emit('update:open', value);
    },
  });

  function toggleOpen() {
    isOpen.value = !isOpen.value;
  }

  function badgeClass(tone: Badge['tone']): string {
    return tone === 'positive' ? 'bg-alert-success-muted text-alert-success-text' : 'bg-background-dark-grey text-body';
  }
</script>

<template>
  <EGCard :padding="0">
    <div class="isolate overflow-hidden" :class="isOpen ? 'rounded-t-2xl' : 'rounded-2xl'">
      <button
        type="button"
        class="hover:bg-background-light-grey flex w-full appearance-none flex-col border-0 bg-transparent px-6 pb-4 pt-4 text-left transition-colors"
        :aria-expanded="isOpen"
        :aria-controls="`${headingId}-content`"
        @click="toggleOpen"
      >
        <span class="flex w-full items-center justify-between gap-4" :class="description ? 'pb-1' : ''">
          <span :id="headingId" class="block text-sm font-medium text-black">{{ title }}</span>
          <span class="flex shrink-0 items-center gap-2">
            <span v-if="summary" class="text-muted max-w-[min(100%,20rem)] truncate text-xs" :title="summary">
              {{ summary }}
            </span>
            <UBadge
              v-for="badge in badges"
              :key="badge.label"
              :ui="{ rounded: 'rounded-xl', base: 'uppercase' }"
              :class="badgeClass(badge.tone)"
            >
              {{ badge.label }}
            </UBadge>
            <UIcon
              name="i-heroicons-chevron-down"
              class="h-5 w-5 shrink-0 transition-transform"
              :class="{ 'rotate-180': isOpen }"
              aria-hidden="true"
            />
          </span>
        </span>
        <span v-if="description" class="flex items-center gap-1.5">
          <span class="text-muted text-xs">{{ description }}</span>
          <UTooltip
            v-if="descriptionTooltip"
            :delay-duration="0"
            :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }"
          >
            <template #text>
              <p>{{ descriptionTooltip }}</p>
            </template>
            <UIcon
              name="i-heroicons-information-circle"
              class="text-muted h-4 w-4 shrink-0"
              :aria-label="`${title} guidance`"
              @click.stop
            />
          </UTooltip>
        </span>
      </button>
    </div>
    <div
      v-if="isOpen"
      :id="`${headingId}-content`"
      role="region"
      :aria-labelledby="headingId"
      class="border-t border-gray-200 px-6 py-4"
    >
      <slot />
    </div>
  </EGCard>
</template>
