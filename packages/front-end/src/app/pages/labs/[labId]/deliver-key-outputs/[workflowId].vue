<script setup lang="ts">
  import { EditWorkflowKeyOutputDeliverySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
  import type { WorkflowKeyOutput } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';

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
  const keyOutputs = ref<WorkflowKeyOutput[]>([]);
  const keyOutputCount = computed(() => keyOutputs.value.length);
  const canSave = ref(false);
  const workflowName = ref(typeof $route.query.workflowName === 'string' ? $route.query.workflowName : '');

  const microreactEnabled = ref(false);
  const microreactMetadataId = ref('');
  const microreactTreeIds = ref<string[]>([]);
  const microreactError = ref('');
  /** True when DynamoDB already has Microreact settings, so Save can clear them. */
  const hadSavedMicroreact = ref(false);

  onBeforeMount(async () => {
    // Always reload: the lab list does not carry HasMicroreactAccessToken.
    uiStore.setRequestPending('loadLabData');
    try {
      await labsStore.loadLab(labId);
    } finally {
      uiStore.setRequestComplete('loadLabData');
    }

    const definition = await keyOutputsStore.load(labId, workflowId);
    if (!definition) return;
    enabled.value = definition.Delivery?.Enabled ?? false;
    destinationUri.value = definition.Delivery?.DestinationUri ?? '';
    keyOutputs.value = definition.KeyOutputs;
    const declaredIds = new Set(definition.KeyOutputs.map((output) => output.KeyOutputId));
    const savedMicroreact = definition.Delivery?.Microreact;
    const metadataId =
      savedMicroreact?.MetadataKeyOutputId && declaredIds.has(savedMicroreact.MetadataKeyOutputId)
        ? savedMicroreact.MetadataKeyOutputId
        : '';
    microreactMetadataId.value = metadataId;
    microreactTreeIds.value = (savedMicroreact?.TreeKeyOutputIds ?? []).filter((id) => declaredIds.has(id));
    // Auto-send needs a metadata role; drop Enabled when the saved ID is gone.
    microreactEnabled.value = Boolean(savedMicroreact?.Enabled && metadataId);
    hadSavedMicroreact.value = Boolean(
      savedMicroreact?.Enabled || savedMicroreact?.MetadataKeyOutputId || savedMicroreact?.TreeKeyOutputIds?.length,
    );
    workflowName.value = definition.WorkflowName || workflowName.value;
    canSave.value = true;
  });

  const labName = computed<string>(() => labsStore.labs[labId]?.Name || '');
  const pageDescription = computed(() => workflowName.value || labName.value);
  const isLoading = computed(() => uiStore.anyRequestPending(['loadLabData', 'loadWorkflowKeyOutputs']));
  const isSaving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputDelivery'));

  const hasMicroreactToken = computed(() => labsStore.labs[labId]?.HasMicroreactAccessToken === true);
  const metadataOptions = computed(() => [
    { label: 'Not sent', value: '' },
    ...keyOutputs.value.map((output) => ({ label: `${output.Label} (${output.Pattern})`, value: output.KeyOutputId })),
  ]);
  const treeCandidates = computed(() =>
    keyOutputs.value.filter((output) => output.KeyOutputId !== microreactMetadataId.value),
  );

  watch(microreactMetadataId, (metadataId) => {
    microreactTreeIds.value = microreactTreeIds.value.filter((id) => id !== metadataId);
    microreactError.value = '';
  });

  function toggleTree(keyOutputId: string, selected: boolean) {
    microreactTreeIds.value = selected
      ? [...microreactTreeIds.value, keyOutputId]
      : microreactTreeIds.value.filter((id) => id !== keyOutputId);
  }

  function backToWorkflowsTab() {
    $router.push(labTab('HealthOmics Workflows'));
  }

  function deliveryRequest() {
    const request: {
      LaboratoryId: string;
      WorkflowId: string;
      Enabled: boolean;
      DestinationUri?: string;
      Microreact?: {
        Enabled: boolean;
        MetadataKeyOutputId?: string;
        TreeKeyOutputIds?: string[];
      };
    } = {
      LaboratoryId: labId,
      WorkflowId: workflowId,
      Enabled: enabled.value,
      DestinationUri: destinationUri.value.trim() || undefined,
    };

    const hasMicroreactConfig =
      microreactEnabled.value || Boolean(microreactMetadataId.value) || microreactTreeIds.value.length > 0;
    // Omit Microreact for S3-only saves so an empty {Enabled:false} is not written. Still send
    // it when clearing previously saved settings.
    if (hasMicroreactConfig || hadSavedMicroreact.value) {
      request.Microreact = {
        Enabled: microreactEnabled.value,
        MetadataKeyOutputId: microreactMetadataId.value || undefined,
        TreeKeyOutputIds: microreactTreeIds.value.length ? microreactTreeIds.value : undefined,
      };
    }
    return request;
  }

  function validateDelivery(): boolean {
    const parsed = EditWorkflowKeyOutputDeliverySchema.safeParse(deliveryRequest());
    destinationError.value = '';
    microreactError.value = '';
    if (parsed.success) return true;

    const destinationIssue = parsed.error.issues.find((item) => item.path.includes('DestinationUri'));
    const microreactIssue = parsed.error.issues.find((item) => item.path.includes('Microreact'));
    if (destinationIssue) destinationError.value = destinationIssue.message;
    if (microreactIssue) microreactError.value = microreactIssue.message;
    if (!destinationIssue && !microreactIssue) {
      destinationError.value = parsed.error.issues[0]?.message ?? 'Enter an s3://bucket/prefix destination';
    }
    return false;
  }

  async function saveDelivery() {
    if (!canSave.value || !validateDelivery()) return;
    const { Enabled, DestinationUri, Microreact } = deliveryRequest();
    const saved = await keyOutputsStore.saveDelivery(labId, workflowId, { Enabled, DestinationUri, Microreact });
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
    <h3 class="mb-4 text-base font-semibold">Copy to S3</h3>
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

    <div class="mt-8 border-t border-neutral-200 pt-6" data-testid="microreact-delivery">
      <h3 class="mb-4 text-base font-semibold">Send to Microreact</h3>
      <UCheckbox
        v-model="microreactEnabled"
        label="Create a Microreact project when a run completes successfully"
        :disabled="keyOutputCount === 0"
      />

      <div class="mt-6">
        <EGFormGroup label="Metadata table" name="microreactMetadata">
          <USelect
            v-model="microreactMetadataId"
            :options="metadataOptions"
            :disabled="keyOutputCount === 0"
            data-testid="microreact-metadata-select"
          />
          <p class="text-muted mt-1 text-sm">A CSV or TSV whose first column is the sample ID.</p>
        </EGFormGroup>
      </div>

      <EGFormGroup v-if="microreactMetadataId && treeCandidates.length" label="Trees" name="microreactTrees">
        <div class="space-y-2">
          <UCheckbox
            v-for="output in treeCandidates"
            :key="output.KeyOutputId"
            :model-value="microreactTreeIds.includes(output.KeyOutputId)"
            :label="`${output.Label} (${output.Pattern})`"
            @update:model-value="(selected: boolean) => toggleTree(output.KeyOutputId, selected)"
          />
        </div>
        <p class="text-muted mt-1 text-sm">Newick files whose leaf labels match the sample IDs.</p>
      </EGFormGroup>

      <p v-if="microreactError" class="text-alert-danger mt-1 text-sm">{{ microreactError }}</p>
      <p v-if="!hasMicroreactToken" class="text-alert-danger mt-2 text-sm">
        This laboratory has no Microreact access token. An organization admin can add one in the laboratory settings.
      </p>
      <p class="text-muted mt-2 text-sm">
        Files are sent to microreact.org as a new private project in the account that owns the laboratory's access
        token. Anyone in the laboratory can also send a completed run from its run page.
      </p>
    </div>

    <div class="mt-6 flex gap-3">
      <EGButton variant="secondary" label="Cancel" :disabled="isSaving" @click="backToWorkflowsTab" />
      <EGButton label="Save" :disabled="!canSave" :loading="isSaving" @click="saveDelivery" />
    </div>
  </section>
</template>
