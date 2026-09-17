<script setup lang="ts">
  import type { TaskListItem } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';

  defineProps<{ tasks: TaskListItem[] }>();
</script>

<template>
  <section
    v-if="tasks.length"
    class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5"
  >
    <h3 class="text-muted mb-4 text-xs font-medium uppercase tracking-wide">Failed tasks</h3>

    <ul class="space-y-2">
      <li v-for="task in tasks" :key="task.taskId" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
        <span class="sr-only">Failed task:</span>
        <span class="font-medium text-red-800">Task {{ task.taskId }} — {{ task.name }}</span>
      </li>
    </ul>
  </section>
</template>
