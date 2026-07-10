<script setup lang="ts">
  import type { HiddenFileTypeBreakdownRow } from '@FE/utils/data-collections-file-type';

  const props = defineProps<{
    hiddenCount: number;
    breakdown: HiddenFileTypeBreakdownRow[];
  }>();

  const emit = defineEmits<{
    openFileTypeFilter: [];
  }>();

  const popoverOpen = ref(false);

  function onOpenFileTypeFilterClick(): void {
    popoverOpen.value = false;
    emit('openFileTypeFilter');
  }

  const chipLabel = computed(() => {
    const n = props.hiddenCount;
    return n === 1 ? '1 hidden by file type' : `${n} hidden by file type`;
  });

  const headerLabel = computed(() => {
    const n = props.hiddenCount;
    const noun = n === 1 ? 'sample' : 'samples';
    return `${n} ${noun} hidden by file type filter`;
  });
</script>

<template>
  <UPopover v-model:open="popoverOpen" :popper="{ placement: 'bottom-start' }">
    <span
      class="text-muted inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-2 pr-2.5 text-xs font-medium hover:bg-gray-100"
      :aria-label="chipLabel"
    >
      <UIcon name="i-heroicons-eye" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ chipLabel }}</span>
    </span>

    <template #panel>
      <div class="w-[min(17.5rem,calc(100vw-2rem))]">
        <div class="border-b border-gray-200 px-3 py-3">
          <h3 class="max-w-[14rem] text-sm font-semibold leading-snug text-gray-900">{{ headerLabel }}</h3>
          <p class="text-muted mt-1.5 max-w-[14rem] text-xs leading-relaxed">
            These samples don't contain any of the file types you've selected.
            <button
              type="button"
              class="text-primary inline font-medium hover:underline"
              @click="onOpenFileTypeFilterClick"
            >
              Use the filter to broaden the scope.
            </button>
          </p>
        </div>

        <ul class="max-h-56 overflow-y-auto py-2">
          <li
            v-for="row in breakdown"
            :key="row.label"
            class="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
          >
            <span class="min-w-0 truncate font-mono text-xs text-gray-800">{{ row.label }}</span>
            <UBadge
              size="xs"
              class="shrink-0 rounded-xl border-0 bg-gray-100 font-serif tabular-nums text-gray-700 ring-0"
            >
              {{ row.count }}
            </UBadge>
          </li>
        </ul>
      </div>
    </template>
  </UPopover>
</template>
