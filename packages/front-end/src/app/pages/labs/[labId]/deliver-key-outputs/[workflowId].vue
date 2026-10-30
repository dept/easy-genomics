<script setup lang="ts">
  import { EditWorkflowKeyOutputDeliverySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
  import { isCompletedHealthOmicsWorkflowRun } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-delivery';
  import type { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { v4 as uuidv4 } from 'uuid';

  type DetailTabKey = 'output-files' | 'integrations';

  const $route = useRoute();
  const $router = useRouter();

  const labId = $route.params.labId as string;
  const workflowId = $route.params.workflowId as string;
  const labsStore = useLabsStore();
  const omicsWorkflowsStore = useOmicsWorkflowsStore();
  const runStore = useRunStore();
  const uiStore = useUiStore();
  const userStore = useUserStore();
  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const { labTab } = useLabBreadcrumbs(labId);

  if (!userStore.canViewLab(labId)) {
    $router.push('/labs');
  }

  const canEditIntegrations = computed(() => userStore.canEditLabUsers(labId));

  const enabled = ref(false);
  const destinationUri = ref('');
  const destinationError = ref('');
  const keyOutputCount = ref(0);
  const definitionLoaded = ref(false);
  const savedEnabled = ref(false);
  const savedDestinationUri = ref('');
  const workflowName = ref(typeof $route.query.workflowName === 'string' ? $route.query.workflowName : '');

  const detailTabs: { key: DetailTabKey; label: string }[] = [
    { key: 'output-files', label: 'Output files' },
    { key: 'integrations', label: 'Integrations' },
  ];

  function tabFromQuery(raw: unknown): DetailTabKey {
    const value = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (value === 'output-files' || value === 'outputs' || value === 'output') return 'output-files';
    return 'integrations';
  }

  const activeTab = ref<DetailTabKey>(tabFromQuery($route.query.tab));

  watch(
    () => $route.query.tab,
    (tab) => {
      activeTab.value = tabFromQuery(tab);
    },
  );

  onBeforeMount(async () => {
    uiStore.setSidebarVisible(true);

    if (!labsStore.labs[labId]) {
      uiStore.setRequestPending('loadLabData');
      try {
        await labsStore.loadLab(labId);
      } finally {
        uiStore.setRequestComplete('loadLabData');
      }
    }

    if (!omicsWorkflowsStore.workflows[workflowId]) {
      try {
        await omicsWorkflowsStore.loadWorkflowsForLab(labId);
      } catch (error) {
        console.error('Failed to load workflow details for key-output delivery page', error);
      }
    }

    uiStore.setRequestPending('loadLabRuns');
    try {
      await runStore.loadLabRunsForLab(labId);
    } finally {
      uiStore.setRequestComplete('loadLabRuns');
    }

    const definition = await keyOutputsStore.load(labId, workflowId);
    if (!definition) return;
    const nextEnabled = definition.Delivery?.Enabled ?? false;
    const nextDestinationUri = definition.Delivery?.DestinationUri ?? '';
    enabled.value = nextEnabled;
    destinationUri.value = nextDestinationUri;
    savedEnabled.value = nextEnabled;
    savedDestinationUri.value = nextDestinationUri;
    keyOutputCount.value = definition.KeyOutputs.length;
    workflowName.value = definition.WorkflowName || workflowName.value;
    definitionLoaded.value = true;
  });

  onBeforeUnmount(() => {
    uiStore.setSidebarVisible(false);
  });

  const lab = computed(() => labsStore.labs[labId] ?? null);
  const labName = computed<string>(() => lab.value?.Name || '');
  const workflow = computed(() => omicsWorkflowsStore.workflows[workflowId]);
  const workflowTitle = computed(() => workflowName.value || workflow.value?.name || 'Workflow');
  const workflowSourceLabel = computed(() => (workflow.value?.source === 'SHARED' ? 'Shared' : 'Private'));
  const isLoading = computed(() => uiStore.anyRequestPending(['loadLabData', 'loadWorkflowKeyOutputs', 'loadLabRuns']));
  const isSaving = computed(() => uiStore.isRequestPending('saveWorkflowKeyOutputDelivery'));
  const hasNoOutputFiles = computed(() => keyOutputCount.value === 0);

  const completedWorkflowRuns = computed<LaboratoryRun[]>(() =>
    runStore
      .labRunsForLab(labId)
      .filter((run) => run.WorkflowExternalId === workflowId && isCompletedHealthOmicsWorkflowRun(run))
      .sort((a, b) => {
        const aTime = a.TerminalAt ?? a.ModifiedAt ?? a.CreatedAt ?? '';
        const bTime = b.TerminalAt ?? b.ModifiedAt ?? b.CreatedAt ?? '';
        return bTime.localeCompare(aTime);
      }),
  );
  const hasUnsavedChanges = computed(
    () => enabled.value !== savedEnabled.value || destinationUri.value.trim() !== savedDestinationUri.value.trim(),
  );
  const canSave = computed(() => definitionLoaded.value && canEditIntegrations.value && hasUnsavedChanges.value);

  const sidebarItems = computed(() => {
    const dashboardTab = { key: 'dashboard', label: 'Dashboard', icon: 'i-heroicons-squares-2x2' };
    const runsTab = { key: 'runs', label: 'Pipeline Runs', icon: 'i-heroicons-clock' };
    const seqeraPipelinesTab = { key: 'seqeraPipelines', label: 'Seqera Pipelines', icon: 'i-heroicons-command-line' };
    const omicsWorkflowsTab = { key: 'omicsWorkflows', label: 'HealthOmics Workflows', icon: 'i-heroicons-beaker' };
    const dataCollectionsTab = {
      key: 'dataCollections',
      label: 'Data Collections',
      icon: 'i-heroicons-rectangle-stack',
    };
    const usersTab = { key: 'users', label: 'Users', icon: 'i-heroicons-users' };
    const detailsTab = { key: 'details', label: 'Settings', icon: 'i-heroicons-cog-6-tooth' };

    const seqeraAvailable = Boolean(lab.value?.NextFlowTowerEnabled);
    const omicsAvailable = Boolean(lab.value?.AwsHealthOmicsEnabled);
    const items = [];

    if (!userStore.isSuperuser) {
      items.push(dashboardTab);
      if (seqeraAvailable || omicsAvailable) items.push(runsTab);
      if (seqeraAvailable) items.push(seqeraPipelinesTab);
      if (omicsAvailable) items.push(omicsWorkflowsTab);
    }
    items.push(dataCollectionsTab);
    items.push({ ...usersTab, dividerBefore: items.length > 0 });
    if (!userStore.isSuperuser && userStore.canEditLabDetails()) items.push(detailsTab);

    return items;
  });

  const sidebarIndex = computed(() => {
    const index = sidebarItems.value.findIndex((item) => item.key === 'omicsWorkflows');
    return index >= 0 ? index : 0;
  });

  usePageTitle(() => `${workflowTitle.value} — ${labName.value || 'Lab'}`);

  function setActiveTab(tab: DetailTabKey) {
    activeTab.value = tab;
    $router.replace({
      query: {
        ...$route.query,
        tab,
        ...(workflowName.value ? { workflowName: workflowName.value } : {}),
      },
    });
  }

  function handleSidebarChange(index: number) {
    const item = sidebarItems.value[index];
    if (!item) return;
    $router.push(labTab(item.label));
  }

  function backToWorkflowsTab() {
    $router.push(labTab('HealthOmics Workflows'));
  }

  function runWorkflow() {
    $router.push({
      path: `/labs/${labId}/run-workflow/${encodeURIComponent(workflowId)}`,
      query: { omicsRunTempId: uuidv4() },
    });
  }

  function validateDestination(): boolean {
    const parsed = EditWorkflowKeyOutputDeliverySchema.safeParse({
      LaboratoryId: labId,
      WorkflowId: workflowId,
      Enabled: enabled.value,
      DestinationUri: destinationUri.value.trim() || undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues.find((item) => item.path.includes('DestinationUri')) ?? parsed.error.issues[0];
      destinationError.value = issue?.message ?? 'Enter an s3://bucket/prefix destination';
      return false;
    }
    destinationError.value = '';
    return true;
  }

  async function saveDelivery() {
    if (!canSave.value || !validateDestination()) return;
    const nextEnabled = enabled.value;
    const nextDestinationUri = destinationUri.value.trim();
    const saved = await keyOutputsStore.saveDelivery(labId, workflowId, {
      Enabled: nextEnabled,
      DestinationUri: nextDestinationUri || undefined,
    });
    if (!saved) return;
    savedEnabled.value = nextEnabled;
    savedDestinationUri.value = nextDestinationUri;
    backToWorkflowsTab();
  }

  function cancelChanges() {
    if (isSaving.value) return;
    backToWorkflowsTab();
  }

  function onOutputFilesSaved() {
    const definition = keyOutputsStore.definitionFor(labId, workflowId);
    keyOutputCount.value = definition?.KeyOutputs.length ?? keyOutputCount.value;
  }
</script>

<template>
  <EGSidebarNav
    v-if="lab"
    aria-label="Lab sections"
    :items="sidebarItems"
    :model-value="sidebarIndex"
    @update:model-value="handleSidebarChange"
  />

  <EGPageHeader
    :title="workflowTitle"
    :show-back="false"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[{ label: 'HealthOmics Workflows', to: labTab('HealthOmics Workflows') }, workflowTitle]"
    :is-loading="isLoading && !workflowTitle"
  >
    <template #titleSuffix>
      <UBadge
        v-if="!isLoading"
        size="sm"
        class="rounded-xl border-0 font-serif ring-0"
        :class="
          workflow?.source === 'SHARED' ? 'bg-alert-blue-muted text-alert-blue' : 'bg-primary-muted text-primary-dark'
        "
      >
        {{ workflowSourceLabel }}
      </UBadge>
    </template>

    <EGButton
      :variant="ButtonVariantEnum.enum.secondary"
      :size="ButtonSizeEnum.enum.sm"
      icon="i-heroicons-play-solid"
      :icon-right="false"
      label="Run"
      @click="runWorkflow"
    />
  </EGPageHeader>

  <template v-if="isLoading">
    <EGLoadingSpinner />
  </template>

  <template v-else>
    <div class="mb-6 flex border-b border-gray-200" role="tablist" aria-label="Workflow output settings">
      <button
        v-for="tab in detailTabs"
        :key="tab.key"
        type="button"
        role="tab"
        class="-mb-px border-b-2 px-1 pb-3 pt-1 text-sm font-medium transition-colors"
        :class="
          activeTab === tab.key ? 'border-primary text-primary' : 'text-muted border-transparent hover:text-gray-800'
        "
        :aria-selected="activeTab === tab.key"
        @click="setActiveTab(tab.key)"
      >
        <span class="px-3">{{ tab.label }}</span>
      </button>
    </div>

    <section v-if="activeTab === 'output-files'" aria-label="Output files">
      <p class="text-muted mb-6 max-w-3xl text-sm">
        Choose the files from this workflow that matter. Integrations send these files, and they&apos;re applied to
        every run of this workflow in {{ labName || 'this laboratory' }}. Pick from a completed run and we&apos;ll match
        the same file in future runs.
      </p>
      <EGDeclareKeyOutputsEditor
        :lab-id="labId"
        :lab-name="labName"
        :available-runs="completedWorkflowRuns"
        hide-intro
        @cancel="backToWorkflowsTab"
        @saved="onOutputFilesSaved"
      />
    </section>

    <section v-else class="w-full" aria-label="Integrations">
      <p class="text-muted mb-6 text-sm">
        When a run of this workflow completes successfully, each integration that&apos;s on sends this workflow&apos;s
        output files.
      </p>

      <div
        v-if="hasNoOutputFiles"
        role="status"
        class="mb-6 flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <UIcon
            name="i-heroicons-exclamation-circle"
            class="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div>
            <p class="font-medium text-amber-950">No output files chosen yet</p>
            <p class="mt-0.5 text-sm text-amber-900">
              Integrations can be turned on now, but nothing will be sent until you choose output files for this
              workflow.
            </p>
          </div>
        </div>
        <EGButton
          class="shrink-0 self-start sm:self-center"
          :variant="ButtonVariantEnum.enum.secondary"
          :size="ButtonSizeEnum.enum.sm"
          label="Choose output files"
          @click="setActiveTab('output-files')"
        />
      </div>

      <div class="flex w-full flex-col gap-4">
        <article class="w-full rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3">
              <div
                class="bg-primary-muted text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                aria-hidden="true"
              >
                <UIcon name="i-heroicons-archive-box" class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <h2 class="text-heading text-base font-semibold">Copy to S3</h2>
                <p class="text-muted mt-0.5 text-sm">Copy output files to an S3 bucket you choose</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium" :class="enabled ? 'text-primary' : 'text-muted'">
                {{ enabled ? 'On' : 'Off' }}
              </span>
              <UToggle v-model="enabled" :disabled="!canEditIntegrations" aria-label="Copy to S3" />
            </div>
          </div>

          <div v-if="enabled" class="mt-6">
            <EGFormGroup label="Destination" name="destinationUri">
              <UInput
                v-model="destinationUri"
                placeholder="s3://bucket/prefix"
                class="font-mono"
                :disabled="!canEditIntegrations"
                :color="destinationError ? 'red' : undefined"
                @update:model-value="destinationError = ''"
              />
              <p v-if="destinationError" class="text-alert-danger mt-1 text-sm">{{ destinationError }}</p>
            </EGFormGroup>
            <p class="text-muted mt-2 text-sm">
              A bucket in another AWS account must give this deployment permission to write. Easy Genomics platform
              buckets and laboratory data prefixes can&apos;t be used.
            </p>
          </div>
        </article>
      </div>

      <div v-if="canEditIntegrations" class="mt-8 flex flex-wrap gap-3">
        <EGButton label="Save changes" :disabled="!canSave" :loading="isSaving" @click="saveDelivery" />
        <EGButton
          :variant="ButtonVariantEnum.enum.secondary"
          label="Cancel"
          :disabled="isSaving"
          @click="cancelChanges"
        />
      </div>
    </section>
  </template>
</template>
