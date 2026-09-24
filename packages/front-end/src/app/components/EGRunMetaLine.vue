<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { getDate } from '@FE/utils/date-time';
  import { formatRunDuration } from '@FE/utils/run-duration';

  const props = defineProps<{ labRun: LaboratoryRun }>();

  /** Owners are stored as email addresses; the local part identifies them at a glance. */
  const ownerLabel = computed<string>(() => props.labRun.Owner?.split('@')[0] ?? '');

  /** Matches the lab view's platform tab icons so the same concept reads the same everywhere. */
  const workflowIcon = computed<string>(() =>
    props.labRun.Platform === 'AWS HealthOmics' ? 'i-heroicons-beaker' : 'i-heroicons-command-line',
  );

  /**
   * Built as data rather than markup so absent values drop out cleanly.
   *
   * Deliberately not a <ul>: `styles/_lists.scss` forces `list-style: disc` and a
   * left margin onto every list item globally, which no utility class overrides.
   */
  const parts = computed(() =>
    [
      { icon: workflowIcon.value, text: props.labRun.WorkflowName },
      { icon: 'i-heroicons-cloud', text: props.labRun.Platform },
      formatRunDuration(props.labRun.RunDurationSeconds)
        ? { icon: 'i-heroicons-clock', text: formatRunDuration(props.labRun.RunDurationSeconds)! }
        : null,
      getDate(props.labRun.CreatedAt)
        ? { icon: 'i-heroicons-calendar-days', text: getDate(props.labRun.CreatedAt)! }
        : null,
      ownerLabel.value
        ? { icon: 'i-heroicons-user', label: 'by', text: ownerLabel.value, title: props.labRun.Owner }
        : null,
    ].filter((part): part is NonNullable<typeof part> => part !== null),
  );
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" aria-label="Run summary">
    <span
      v-for="(part, index) in parts"
      :key="index"
      :title="part.title"
      class="stroke-light text-muted inline-flex items-center gap-1.5 rounded-full border border-solid bg-white px-3 py-1 text-xs"
    >
      <UIcon :name="part.icon" class="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
      <span v-if="part.label" class="text-gray-400">{{ part.label }}</span>
      <span class="text-black">{{ part.text }}</span>
    </span>
  </div>
</template>
