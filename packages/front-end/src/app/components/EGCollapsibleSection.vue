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
      defaultOpen?: boolean;
    }>(),
    {
      description: '',
      descriptionTooltip: '',
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
    <div class="isolate overflow-hidden" :class="isOpen || description ? 'rounded-t-2xl' : 'rounded-2xl'">
      <button
        type="button"
        class="hover:bg-primary-muted flex w-full appearance-none items-center justify-between gap-4 border-0 bg-transparent px-6 pt-4 text-left transition-colors"
        :class="description ? 'pb-1' : 'pb-4'"
        :aria-expanded="isOpen"
        :aria-controls="`${headingId}-content`"
        @click="isOpen = !isOpen"
      >
        <span :id="headingId" class="block text-sm font-medium text-black">{{ title }}</span>
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
    </div>
    <div v-if="description" class="flex items-center gap-1.5 px-6 pb-4">
      <p class="text-muted text-xs">{{ description }}</p>
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
        />
      </UTooltip>
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
