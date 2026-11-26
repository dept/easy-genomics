<script setup lang="ts">
  import type { RunLimitEventsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-limit-events';
  import type { RunCostsReport } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
  import { periodLabel } from '@FE/utils/run-costs';
  import { blockReasonLabel, formatRunLimitHit } from '@FE/utils/run-limit-events';

  const props = defineProps<{
    modelValue: boolean;
    /** The Run costs period on screen, plus the kind of launch to list. */
    query: RunLimitEventsQuery;
    /** Every event also wrote a totals row for its period, so the report always names its lab and workflow. */
    report: RunCostsReport | null;
  }>();

  const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
  }>();

  const runLimitEventsStore = useRunLimitEventsStore();

  watch(
    () => props.modelValue,
    (isOpen) => {
      if (isOpen) runLimitEventsStore.load(props.query);
    },
    { immediate: true },
  );

  const title = computed(
    () => `${props.query.kind === 'warned' ? 'Warned' : 'Blocked'} launches · ${periodLabel(props.query)}`,
  );

  // The store may still hold the other kind's list while this one loads.
  const answersThisQuery = computed(() => JSON.stringify(runLimitEventsStore.query) === JSON.stringify(props.query));
  const events = computed(() => (answersThisQuery.value ? (runLimitEventsStore.response?.Events ?? []) : []));
  const truncated = computed(() => answersThisQuery.value && runLimitEventsStore.response?.Truncated === true);
  const showLoading = computed(() => runLimitEventsStore.loading && !answersThisQuery.value);
  // With no list for this query to fall back on, a failed load must not read as "None in this period".
  const loadFailed = computed(
    () => !answersThisQuery.value && JSON.stringify(runLimitEventsStore.failedQuery) === JSON.stringify(props.query),
  );

  const laboratoryNames = computed(
    () => new Map((props.report?.Labs ?? []).map((lab) => [lab.LaboratoryId, lab.LaboratoryName])),
  );
  const workflowNames = computed(
    () =>
      new Map(
        (props.report?.Labs ?? []).flatMap((lab) =>
          lab.Workflows.map((workflow) => [
            `${workflow.Platform}#${workflow.WorkflowExternalId}`,
            workflow.WorkflowName,
          ]),
        ),
      ),
  );

  function laboratoryName(laboratoryId: string): string {
    return laboratoryNames.value.get(laboratoryId) ?? laboratoryId;
  }

  function workflowName(platform: string, workflowExternalId: string): string {
    return workflowNames.value.get(`${platform}#${workflowExternalId}`) ?? workflowExternalId;
  }

  function formatOccurredAt(occurredAt: string): string {
    return new Date(occurredAt).toLocaleString();
  }
</script>

<template>
  <USlideover
    :model-value="modelValue"
    side="right"
    :ui="{ width: 'w-screen max-w-2xl' }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <UCard
      class="flex h-full flex-col"
      :ui="{
        body: { base: 'flex-1 overflow-y-auto' },
        rounded: 'rounded-none',
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <UButton
            variant="ghost"
            size="sm"
            icon="i-heroicons-x-mark"
            aria-label="Close"
            @click="emit('update:modelValue', false)"
          />
        </div>
      </template>

      <div :aria-busy="showLoading" class="flex flex-col gap-4">
        <USkeleton v-if="showLoading" class="h-48 w-full" data-testid="run-limit-events-loading" />

        <div v-else-if="loadFailed" class="flex flex-col items-start gap-2 text-sm" role="alert">
          <p class="m-0">Couldn't load these launches.</p>
          <UButton size="xs" variant="outline" @click="runLimitEventsStore.load(query)">Try again</UButton>
        </div>

        <p v-else-if="events.length === 0" class="text-muted text-sm" role="status">None in this period.</p>

        <template v-else>
          <p v-if="truncated" class="text-muted text-sm" role="status">Showing the latest 500.</p>
          <ul class="m-0 flex list-none flex-col gap-3 p-0">
            <li
              v-for="event in events"
              :key="event.EventKey"
              data-testid="run-limit-event-row"
              class="border-background-dark-grey list-none rounded-lg border p-3 text-sm"
            >
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="font-medium">{{ event.UserDisplayName }}</span>
                <time :datetime="event.OccurredAt" class="text-muted text-xs">
                  {{ formatOccurredAt(event.OccurredAt) }}
                </time>
              </div>
              <div class="text-muted">
                {{ laboratoryName(event.LaboratoryId) }} ·
                {{ workflowName(event.Platform, event.WorkflowExternalId) }}
              </div>
              <div v-if="event.Hits.length > 0">{{ event.Hits.map(formatRunLimitHit).join(', ') }}</div>
              <div v-if="event.Kind === 'warned' && event.RunName" class="text-muted">Run: {{ event.RunName }}</div>
              <div v-if="event.Kind === 'blocked'" class="text-muted">{{ blockReasonLabel(event.Reason) }}</div>
            </li>
          </ul>
        </template>
      </div>
    </UCard>
  </USlideover>
</template>
