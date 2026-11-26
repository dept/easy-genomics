<script setup lang="ts">
  interface Badge {
    label: string;
    tone?: 'positive' | 'neutral';
  }

  /**
   * One section of the lab details form. `collapsible` is the lab Settings card; `grid` is the Create a new lab
   * row, with the title and description on the left and the fields on the right.
   */
  withDefaults(
    defineProps<{
      layout: 'collapsible' | 'grid';
      headingId: string;
      title: string;
      description?: string;
      badges?: Badge[];
      summary?: string;
      open?: boolean;
    }>(),
    {
      description: '',
      badges: () => [],
      summary: '',
      open: undefined,
    },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
  }>();
</script>

<template>
  <EGCollapsibleSection
    v-if="layout === 'collapsible'"
    :heading-id="headingId"
    :title="title"
    :description="description"
    :badges="badges"
    :summary="summary"
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <slot />
  </EGCollapsibleSection>

  <section
    v-else
    :aria-labelledby="headingId"
    class="border-stroke-light grid grid-cols-1 gap-4 border-t px-6 py-8 first:border-t-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10"
  >
    <div>
      <h2 :id="headingId" class="text-heading text-base font-medium">{{ title }}</h2>
      <p v-if="description" class="text-muted mt-1 text-sm">{{ description }}</p>
    </div>
    <div class="min-w-0">
      <slot />
    </div>
  </section>
</template>
