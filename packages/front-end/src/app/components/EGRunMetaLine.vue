<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { formatCompactDateTime } from '@FE/utils/date-time';
  import { formatRunDuration } from '@FE/utils/run-duration';

  const props = defineProps<{ labRun: LaboratoryRun }>();

  /** Owners are stored as email addresses; the local part identifies them at a glance. */
  const ownerLabel = computed<string>(() => props.labRun.Owner?.split('@')[0] ?? '');

  /**
   * One prose line instead of the old pill row: workflow, platform, who started it,
   * and how long it took. Missing pieces drop out so the separators stay clean.
   */
  const text = computed<string>(() => {
    const parts: string[] = [];

    const workflow = props.labRun.WorkflowName?.trim();
    const platform = props.labRun.Platform?.trim();
    if (workflow && platform) {
      parts.push(`${workflow} on ${platform}`);
    } else if (workflow) {
      parts.push(workflow);
    } else if (platform) {
      parts.push(platform);
    }

    const startedAt = formatCompactDateTime(props.labRun.CreatedAt);
    if (ownerLabel.value && startedAt) {
      parts.push(`Started by ${ownerLabel.value} on ${startedAt}`);
    } else if (ownerLabel.value) {
      parts.push(`Started by ${ownerLabel.value}`);
    } else if (startedAt) {
      parts.push(`Started on ${startedAt}`);
    }

    const duration = formatRunDuration(props.labRun.RunDurationSeconds);
    if (duration) {
      parts.push(`Took ${duration}`);
    }

    return parts.join(' · ');
  });
</script>

<template>
  <p v-if="text" class="text-muted text-sm" :title="labRun.Owner || undefined">
    {{ text }}
  </p>
</template>
