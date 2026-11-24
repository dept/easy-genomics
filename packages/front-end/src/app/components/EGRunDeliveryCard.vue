<script setup lang="ts">
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import type { WorkflowKeyOutputDelivery } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';

  const props = defineProps<{
    labId: string;
    run: LaboratoryRun;
    delivery?: WorkflowKeyOutputDelivery | null;
    workflowId?: string | null;
  }>();

  const emit = defineEmits<{
    openSelectedResults: [];
  }>();

  const $router = useRouter();

  const showS3 = computed(() => !!props.delivery?.Enabled && !!props.delivery.DestinationUri?.trim());
  const microreactConfigured = computed(() => Boolean(props.delivery?.Microreact?.MetadataKeyOutputId));
  // Keep the Microreact CTA beside S3; only hide both when nothing is configured.
  const showMicroreactRow = computed(() => microreactConfigured.value || showS3.value);

  function openIntegrations(): void {
    if (!props.workflowId) return;
    void $router.push({
      path: `/labs/${props.labId}/deliver-key-outputs/${encodeURIComponent(props.workflowId)}`,
      query: {
        tab: 'integrations',
        ...(props.run.WorkflowName ? { workflowName: props.run.WorkflowName } : {}),
      },
    });
  }
</script>

<template>
  <section class="stroke-light flex flex-col rounded-2xl border border-solid bg-white p-6 max-md:px-5">
    <h3 class="text-sm font-semibold text-black">Delivery</h3>
    <p class="text-muted mt-1 text-sm">
      Where this run's
      <button
        type="button"
        class="text-primary hover:text-primary-dark font-medium hover:underline"
        @click="emit('openSelectedResults')"
      >
        selected results
      </button>
      were sent.
    </p>

    <div class="mt-5 space-y-5">
      <div v-if="showS3" class="flex items-start gap-3">
        <div class="flex min-w-0 flex-1 items-start gap-3">
          <UIcon name="i-heroicons-cloud" class="text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-black">Amazon S3</p>
            <p class="text-muted mt-0.5 break-all text-sm">{{ delivery?.DestinationUri }}</p>
          </div>
        </div>
        <UBadge
          size="sm"
          class="bg-alert-success-muted text-alert-success-text mt-0.5 shrink-0 rounded-xl border-0 ring-0"
        >
          Copied
        </UBadge>
      </div>

      <div v-if="showMicroreactRow" class="flex items-start justify-between gap-3">
        <template v-if="microreactConfigured">
          <EGMicroreactExport :lab-id="labId" :run="run" />
        </template>
        <template v-else>
          <div class="flex min-w-0 items-start gap-3">
            <UIcon name="i-heroicons-share" class="text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-black">Microreact</p>
              <p class="text-muted mt-0.5 text-sm">
                Not turned on for this workflow.
                <button
                  v-if="workflowId"
                  type="button"
                  class="text-primary hover:text-primary-dark font-medium hover:underline"
                  @click="openIntegrations"
                >
                  Integrations
                </button>
              </p>
            </div>
          </div>
        </template>
      </div>

      <p v-if="!showS3 && !showMicroreactRow" class="text-muted text-sm">No delivery configured for this workflow.</p>
    </div>
  </section>
</template>
