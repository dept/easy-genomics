<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { format } from 'date-fns';
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
  const hasProject = computed(() => Boolean(props.run.MicroreactProjectUrl));
  const isSucceeded = computed(() => props.run.MicroreactStatus === 'Succeeded' && hasProject.value);
  const isFailed = computed(() => props.run.MicroreactStatus === 'Failed');
  const buttonLabel = computed(() => (hasProject.value ? 'Send again' : 'Send to Microreact'));

  const statusText = computed(() => {
    if (isQueued.value) return 'Sending output files to Microreact…';
    if (isFailed.value) return props.run.MicroreactErrorMessage || 'The last export failed.';
    if (props.run.MicroreactStatus === 'Queued') return 'The last export did not finish. Send it again.';
    if (isSucceeded.value) {
      const requestedAt = props.run.MicroreactRequestedAt
        ? (() => {
            const date = new Date(props.run.MicroreactRequestedAt);
            return Number.isNaN(date.getTime()) ? null : format(date, 'h:mm aaa');
          })()
        : null;
      return requestedAt ? `Private project created at ${requestedAt}` : 'Private project created';
    }
    return "Create a private project from this run's output files.";
  });

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

  function openProject() {
    if (!props.run.MicroreactProjectUrl) return;
    window.open(props.run.MicroreactProjectUrl, '_blank', 'noopener,noreferrer');
  }
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-3" data-testid="microreact-export">
    <div class="flex min-w-0 items-start gap-3">
      <img src="@/assets/images/microreact-logo.svg" alt="" class="mt-0.5 h-5 w-5 shrink-0" width="20" height="20" />
      <div class="min-w-0">
        <p class="text-sm font-medium text-black">Microreact</p>
        <p class="mt-0.5 text-sm" :class="isFailed ? 'text-alert-danger' : 'text-muted'">
          {{ statusText }}
        </p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <UBadge
        v-if="isSucceeded"
        size="sm"
        class="bg-alert-success-muted text-alert-success-text rounded-xl border-0 ring-0"
      >
        Sent
      </UBadge>
      <EGButton
        v-if="hasProject"
        label="Open project"
        icon="i-heroicons-arrow-top-right-on-square"
        :icon-right="true"
        :variant="ButtonVariantEnum.enum.secondary"
        :size="ButtonSizeEnum.enum.sm"
        data-testid="microreact-project-link"
        @click="openProject"
      />
      <EGButton
        :label="buttonLabel"
        :variant="ButtonVariantEnum.enum.secondary"
        :size="ButtonSizeEnum.enum.sm"
        :loading="isRequesting || isQueued"
        :disabled="isRequesting || isQueued"
        @click="send"
      />
    </div>
  </div>
</template>
