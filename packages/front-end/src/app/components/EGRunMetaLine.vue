<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { getDate } from '@FE/utils/date-time';
  import { formatRunDuration } from '@FE/utils/run-duration';

  const props = defineProps<{ labRun: LaboratoryRun }>();

  /** Owners are stored as email addresses; the local part identifies them at a glance. */
  const ownerLabel = computed<string>(() => props.labRun.Owner?.split('@')[0] ?? '');

  /**
   * Built as data rather than markup so separators can be placed between items
   * without a trailing one, and so absent values drop out cleanly.
   *
   * Deliberately not a <ul>: `styles/_lists.scss` forces `list-style: disc` and a
   * left margin onto every list item globally, which no utility class overrides.
   */
  const parts = computed(() =>
    [
      { text: props.labRun.WorkflowName, strong: true },
      { text: props.labRun.Platform },
      formatRunDuration(props.labRun.RunDurationSeconds)
        ? { label: 'Ran', text: formatRunDuration(props.labRun.RunDurationSeconds)!, strong: true }
        : null,
      getDate(props.labRun.CreatedAt) ? { text: getDate(props.labRun.CreatedAt)! } : null,
      ownerLabel.value ? { label: 'by', text: ownerLabel.value, strong: true, title: props.labRun.Owner } : null,
    ].filter((part): part is NonNullable<typeof part> => part !== null),
  );
</script>

<template>
  <div class="text-muted flex flex-wrap items-center text-sm" aria-label="Run summary">
    <template v-for="(part, index) in parts" :key="index">
      <span v-if="index > 0" class="px-2 text-gray-300" aria-hidden="true">·</span>

      <span>
        <template v-if="part.label">{{ part.label }}</template>
        <span :class="part.strong ? 'text-black' : ''" :title="part.title">{{ part.text }}</span>
      </span>
    </template>
  </div>
</template>
