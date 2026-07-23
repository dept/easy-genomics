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
      badges?: Badge[];
      defaultOpen?: boolean;
    }>(),
    {
      description: '',
      badges: () => [],
      defaultOpen: false,
    },
  );

  const isOpen = ref(props.defaultOpen);

  function badgeClass(tone: Badge['tone']): string {
    return tone === 'positive' ? 'bg-alert-success-muted text-alert-success-text' : 'bg-background-dark-grey text-body';
  }
</script>

<template>
  <EGCard :padding="0">
    <button
      type="button"
      class="hover:bg-primary-muted flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
      :aria-expanded="isOpen"
      :aria-controls="`${headingId}-content`"
      @click="isOpen = !isOpen"
    >
      <span>
        <span :id="headingId" class="block text-sm font-medium text-black">{{ title }}</span>
        <span v-if="description" class="text-muted mt-1 block text-xs">{{ description }}</span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
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
    </button>
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
