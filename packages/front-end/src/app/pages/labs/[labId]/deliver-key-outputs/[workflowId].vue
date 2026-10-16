<script setup lang="ts">
  import { EditWorkflowKeyOutputDeliverySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';

  const $route = useRoute();
  const $router = useRouter();

  const labId = $route.params.labId as string;
  const workflowId = $route.params.workflowId as string;
  const labsStore = useLabsStore();
  const uiStore = useUiStore();
  const userStore = useUserStore();
  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const { labTab } = useLabBreadcrumbs(labId);

  if (!userStore.canEditLabUsers(labId)) {
    $router.push('/labs');
  }

  const enabled = ref(false);
  const destinationUri = ref('');
  const destinationError = ref('');
  const keyOutputCount = ref(0);
  const canSave = ref(false);
  const workflowName = ref(typeof $route.query.workflowName === 'string' ? $route.query.workflowName : '');

  onBeforeMount(async () => {
    if (!labsStore.labs[labId]) {
      uiStore.setRequestPending('loadLabData');
      try {
        await labsStore.loadLab(labId);
      } finally {
        uiStore.setRequestComplete('loadLabData');
      }
    }

    const definition = await keyOutputsStore.load(labId, workflowId);
    if (!definition) return;
    enabled.value = definition.Delivery?.Enabled ?? false;
    destinationUri.value = definition.Delivery?.DestinationUri ?? '';
    keyOutputCount.value = definition.KeyOutputs.length;
    workflowName.value = definition.WorkflowName || workflowName.value;
    canSave.value = true;
  });

  const labName = computed<string>(() => labsStore.labs[labId]?.Name || '');
  const pageDescription = computed(() => workflowName.value || labName.value);
  const isLoading = computed(() => uiStore.anyRequestPending(['loadLabData', 'loadWorkflowKeyOutputs']));
  const isSaving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputDelivery'));

  function backToWorkflowsTab() {
    $router.push(labTab('HealthOmics Workflows'));
  }

  function validateDestination(): boolean {
    const parsed = EditWorkflowKeyOutputDeliverySchema.safeParse({
      LaboratoryId: labId,
      WorkflowId: workflowId,
      Enabled: enabled.value,
      DestinationUri: destinationUri.value.trim() || undefined,
    });
    if (!parsed.success) {
      const issue =
        parsed.error.issues.find((item) => item.path.includes('DestinationUri')) ?? parsed.error.issues[0];
      destinationError.value = issue?.message ?? 'Enter an s3://bucket/prefix destination';
      return false;
    }
    destinationError.value = '';
    return true;
  }

  async function saveDelivery() {
    if (!canSave.value || !validateDestination()) return;
    const saved = await keyOutputsStore.saveDelivery(labId, workflowId, {
      Enabled: enabled.value,
      DestinationUri: destinationUri.value.trim() || undefined,
    });
    if (saved) backToWorkflowsTab();
  }
</script>

<template>
  <EGPageHeader
    title="Deliver Key Outputs"
    :description="pageDescription"
    :show-back="true"
    :back-action="backToWorkflowsTab"
    back-button-label="Back to Workflows"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[{ label: 'HealthOmics Workflows', to: labTab('HealthOmics Workflows') }, 'Deliver Key Outputs']"
  />

  <template v-if="isLoading">
    <EGLoadingSpinner />
  </template>

  <section v-else class="max-w-xl rounded-2xl border border-neutral-200 bg-white p-6">
    <UCheckbox v-model="enabled" label="Send key outputs when a run completes successfully" />

    <div class="mt-6">
      <EGFormGroup label="Destination" name="destinationUri">
        <UInput
          v-model="destinationUri"
          placeholder="s3://bucket/prefix"
          class="font-mono"
          :color="destinationError ? 'red' : undefined"
          @update:model-value="destinationError = ''"
        />
        <p v-if="destinationError" class="text-alert-danger mt-1 text-sm">{{ destinationError }}</p>
      </EGFormGroup>
    </div>

    <p class="text-muted text-sm">
      A bucket in another AWS account must grant this deployment permission to write. Easy Genomics platform buckets and
      laboratory data prefixes are rejected.
    </p>
    <p v-if="keyOutputCount === 0" class="text-muted mt-2 text-sm">
      Nothing will be copied until key outputs are declared for this workflow.
    </p>

    <div class="mt-6 flex gap-3">
      <EGButton variant="secondary" label="Cancel" :disabled="isSaving" @click="backToWorkflowsTab" />
      <EGButton label="Save" :disabled="!canSave" :loading="isSaving" @click="saveDelivery" />
    </div>
  </section>
</template>
