<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      percent?: number | null;
      completed?: number | null;
      total?: number | null;
      /** Compact mode for table cells */
      compact?: boolean;
    }>(),
    {
      percent: null,
      completed: null,
      total: null,
      compact: false,
    },
  );

  const hasCounts = computed(() => props.completed != null && props.total != null && props.total > 0);
  const hasPercent = computed(() => props.percent != null && Number.isFinite(props.percent));
  const clampedPercent = computed(() => {
    if (!hasPercent.value) return 0;
    return Math.min(100, Math.max(0, Math.round(props.percent as number)));
  });
  const countsLabel = computed(() => {
    if (!hasCounts.value) return null;
    return `${props.completed}/${props.total} tasks`;
  });
  const ariaLabel = computed(() => {
    const parts: string[] = [];
    if (hasPercent.value) parts.push(`${clampedPercent.value}% complete`);
    if (countsLabel.value) parts.push(countsLabel.value);
    return parts.length ? parts.join(', ') : 'Progress unavailable';
  });
</script>

<template>
  <div
    v-if="hasPercent || hasCounts"
    class="flex flex-col gap-1"
    :class="compact ? 'min-w-[7rem]' : 'w-full max-w-md'"
    role="group"
    :aria-label="ariaLabel"
  >
    <div class="flex items-baseline justify-between gap-2 text-xs">
      <span v-if="hasPercent" class="text-body font-medium">{{ clampedPercent }}%</span>
      <span v-if="countsLabel" class="text-muted" :title="countsLabel">{{ countsLabel }}</span>
    </div>
    <UProgress v-if="hasPercent" :value="clampedPercent" :max="100" size="sm" :aria-label="ariaLabel" />
  </div>
  <span v-else class="text-muted text-sm">—</span>
</template>
