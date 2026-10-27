<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';

  const props = defineProps<{
    labId: string;
    run: LaboratoryRun;
  }>();

  const POLL_INTERVAL_MS = 5000;
  /** A queued export older than this is treated as stranded so the page stops polling. */
  const STALE_QUEUED_MS = 20 * 60 * 1000;

  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const runStore = useRunStore();
  const uiStore = useUiStore();

  const isRequesting = computed(() => uiStore.isRequestPending('requestMicroreactExport'));
  const isQueued = computed(() => {
    if (props.run.MicroreactStatus !== 'Queued') return false;
    const requestedAt = Date.parse(props.run.MicroreactRequestedAt ?? '');
    return Number.isNaN(requestedAt) || Date.now() - requestedAt < STALE_QUEUED_MS;
  });
  const buttonLabel = computed(() => (props.run.MicroreactProjectUrl ? 'Send again' : 'Send to Microreact'));

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  watch(
    isQueued,
    (queued) => {
      stopPolling();
      if (queued) pollTimer = setInterval(() => void runStore.loadSingleLabRun(props.run.RunId), POLL_INTERVAL_MS);
    },
    { immediate: true },
  );

  onBeforeUnmount(stopPolling);

  async function send() {
    const queued = await keyOutputsStore.requestMicroreactExport(props.labId, props.run.RunId);
    if (queued) await runStore.loadSingleLabRun(props.run.RunId);
  }
</script>

<template>
  <section class="rounded-2xl border border-neutral-200 bg-white p-6" data-testid="microreact-export">
    <div class="flex items-start justify-between gap-4">
      <div>
        <EGText tag="h3">Microreact</EGText>
        <p v-if="isQueued" class="text-muted mt-1 text-sm">Sending key outputs to Microreact…</p>
        <p v-else-if="run.MicroreactStatus === 'Failed'" class="text-alert-danger mt-1 text-sm">
          {{ run.MicroreactErrorMessage || 'The last export failed.' }}
        </p>
        <p v-else-if="run.MicroreactStatus === 'Queued'" class="text-muted mt-1 text-sm">
          The last export did not finish. Send it again.
        </p>
        <p v-else-if="!run.MicroreactProjectUrl" class="text-muted mt-1 text-sm">
          Create a private Microreact project from this run's key outputs.
        </p>
        <a
          v-if="run.MicroreactProjectUrl"
          :href="run.MicroreactProjectUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary mt-1 inline-block text-sm font-medium hover:underline"
          data-testid="microreact-project-link"
        >
          Open in Microreact
        </a>
      </div>
      <EGButton
        :label="buttonLabel"
        :variant="ButtonVariantEnum.enum.secondary"
        :size="ButtonSizeEnum.enum.sm"
        :loading="isRequesting || isQueued"
        :disabled="isRequesting || isQueued"
        @click="send"
      />
    </div>
  </section>
</template>
