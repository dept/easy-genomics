<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      percent?: number | null;
      completed?: number | null;
      total?: number | null;
      /**
       * - default: stacked % + counts above a full-width bar (run detail)
       * - inline: mini bar + % for table "Last updated" cells
       * - full: full-width bar with % on the right (dashboard In progress cards)
       */
      variant?: 'default' | 'inline' | 'full';
      /** Compact alias kept for callers that still pass it; maps to inline. */
      compact?: boolean;
      /** Optional remaining-time label (e.g. "~12 min remaining"). */
      remainingLabel?: string | null;
    }>(),
    {
      percent: null,
      completed: null,
      total: null,
      variant: 'default',
      compact: false,
      remainingLabel: null,
    },
  );

  const resolvedVariant = computed(() => {
    if (props.compact && props.variant === 'default') return 'inline';
    return props.variant;
  });

  const hasCounts = computed(() => props.completed != null && props.total != null && props.total > 0);
  const hasPercent = computed(() => props.percent != null && Number.isFinite(props.percent));
  const clampedPercent = computed(() => {
    if (!hasPercent.value) return 0;
    return Math.min(100, Math.max(0, Math.round(props.percent as number)));
  });

  const countsLabel = computed(() => {
    if (!hasCounts.value) return null;
    if (resolvedVariant.value === 'inline') {
      return `${props.completed} / ${props.total}`;
    }
    if (resolvedVariant.value === 'full') {
      return `${props.completed} / ${props.total} processes`;
    }
    return `${props.completed}/${props.total} tasks`;
  });

  const metaline = computed(() => {
    const parts: string[] = [];
    if (countsLabel.value) parts.push(countsLabel.value);
    if (props.remainingLabel) parts.push(props.remainingLabel);
    return parts.length ? parts.join(' · ') : null;
  });

  const ariaLabel = computed(() => {
    const parts: string[] = [];
    if (hasPercent.value) parts.push(`${clampedPercent.value}% complete`);
    if (metaline.value) parts.push(metaline.value);
    return parts.length ? parts.join(', ') : 'Progress unavailable';
  });
</script>

<template>
  <div
    v-if="hasPercent || hasCounts"
    role="group"
    :aria-label="ariaLabel"
    class="flex flex-col"
    :class="resolvedVariant === 'default' ? 'w-full max-w-md gap-1' : ''"
  >
    <!-- Inline (Pipeline Runs Last updated): mini bar + % -->
    <template v-if="resolvedVariant === 'inline'">
      <div v-if="hasPercent" class="mb-0.5 flex items-center gap-2">
        <div class="bg-background-light-grey h-[5px] w-[88px] overflow-hidden rounded-full" aria-hidden="true">
          <div class="bg-primary h-full rounded-full" :style="{ width: `${clampedPercent}%` }" />
        </div>
        <span class="text-body text-xs font-semibold">{{ clampedPercent }}%</span>
      </div>
      <div v-if="metaline" class="text-muted text-xs">{{ metaline }}</div>
    </template>

    <!-- Full (In progress card): bar with % on the right -->
    <template v-else-if="resolvedVariant === 'full'">
      <div v-if="hasPercent" class="flex items-center gap-3.5">
        <div class="bg-background-light-grey h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden="true">
          <div class="bg-primary h-full rounded-full" :style="{ width: `${clampedPercent}%` }" />
        </div>
        <span class="text-body min-w-[38px] text-right text-sm font-semibold">{{ clampedPercent }}%</span>
      </div>
      <div v-if="metaline" class="text-muted mt-2.5 text-xs">{{ metaline }}</div>
    </template>

    <!-- Default (run detail): % + counts above Nuxt progress -->
    <template v-else>
      <div class="flex items-baseline justify-between gap-2 text-xs">
        <span v-if="hasPercent" class="text-body font-medium">{{ clampedPercent }}%</span>
        <span v-if="countsLabel" class="text-muted" :title="countsLabel">{{ countsLabel }}</span>
      </div>
      <UProgress v-if="hasPercent" :value="clampedPercent" :max="100" size="sm" :aria-label="ariaLabel" />
    </template>
  </div>
  <span v-else class="text-muted text-sm">—</span>
</template>
