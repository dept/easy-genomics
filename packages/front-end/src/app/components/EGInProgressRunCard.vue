<script setup lang="ts">
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { getTime } from '@FE/utils/date-time';

  const props = defineProps<{
    run: LaboratoryRun;
    labId: string;
  }>();

  const $router = useRouter();
  const expanded = ref(false);
  const detailsId = computed(() => `in-progress-details-${props.run.RunId}`);

  const hasProgress = computed(
    () => props.run.ProgressPercent != null || (props.run.TasksCompleted != null && props.run.TasksTotal != null),
  );

  const elapsedLabel = computed(() => formatElapsed(props.run.CreatedAt));

  function formatElapsed(createdAt?: string): string {
    if (!createdAt) return '—';
    const started = new Date(createdAt).getTime();
    if (!Number.isFinite(started)) return '—';
    const totalSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  function viewProgress() {
    $router.push({
      path: `/labs/${props.labId}/run/${props.run.RunId}`,
      query: { tab: 'Run Details' },
    });
  }

  function toggleDetails() {
    expanded.value = !expanded.value;
  }
</script>

<template>
  <div class="rounded-xl border border-neutral-100 bg-white px-5 py-4">
    <div class="mb-3.5 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5 text-[14.5px] font-semibold">
        <span class="text-body">{{ run.RunName }}</span>
        <EGStatusChip :status="run.Status" />
      </div>
      <button
        type="button"
        class="text-primary hover:text-primary-dark focus-visible:outline-primary-500 shrink-0 border-0 bg-transparent p-0 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        @click="viewProgress"
      >
        View progress →
      </button>
    </div>

    <EGProgressBar
      v-if="hasProgress"
      variant="full"
      :percent="run.ProgressPercent"
      :completed="run.TasksCompleted"
      :total="run.TasksTotal"
    />
    <p v-else class="text-muted text-sm">Progress updates will appear once the workflow reports tasks.</p>

    <div :id="detailsId" v-show="expanded" class="mt-4">
      <div class="mb-4 h-px bg-neutral-100" aria-hidden="true" />
      <dl class="flex flex-wrap gap-x-11 gap-y-4">
        <div class="min-w-[92px]">
          <dt class="text-muted mb-0.5 text-xs">Workflow</dt>
          <dd class="text-body m-0 text-sm font-medium">{{ run.WorkflowName || '—' }}</dd>
        </div>
        <div class="min-w-[92px]">
          <dt class="text-muted mb-0.5 text-xs">Started</dt>
          <dd class="text-body m-0 text-sm font-medium">{{ getTime(run.CreatedAt) || '—' }}</dd>
        </div>
        <div class="min-w-[92px]">
          <dt class="text-muted mb-0.5 text-xs">Owner</dt>
          <dd class="text-body m-0 text-sm font-medium">{{ run.Owner || '—' }}</dd>
        </div>
        <div class="min-w-[92px]">
          <dt class="text-muted mb-0.5 text-xs">Elapsed</dt>
          <dd class="text-body m-0 text-sm font-medium">{{ elapsedLabel }}</dd>
        </div>
      </dl>
    </div>

    <button
      type="button"
      class="text-primary focus-visible:outline-primary-500 mt-3 flex items-center gap-1.5 border-0 bg-transparent p-0 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      :aria-expanded="expanded"
      :aria-controls="detailsId"
      @click="toggleDetails"
    >
      <span>{{ expanded ? 'Hide details' : 'Show details' }}</span>
      <UIcon
        name="i-heroicons-chevron-down-20-solid"
        class="h-3.5 w-3.5 transition-transform duration-150"
        :class="{ 'rotate-180': expanded }"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
