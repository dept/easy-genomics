<script setup lang="ts">
  import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { useLabsStore, useRunStore, useUiStore } from '@FE/stores';

  const $route = useRoute();
  const $router = useRouter();
  const { $api } = useNuxtApp();
  const { handleS3Download } = useFileDownload();
  const { platformToPipelineOrWorkflow } = useMultiplatform();

  const labsStore = useLabsStore();
  const runStore = useRunStore();
  const uiStore = useUiStore();

  const labId = $route.params.labId as string;
  const labRunId = $route.params.labRunId as string;

  const lab = computed<Laboratory | null>(() => labsStore.labs[labId] ?? null);
  const labRun = computed<LaboratoryRun | null>(() => runStore.labRuns[labRunId] ?? null);
  // The LaboratoryRun's InputS3Url is the authoritative reference to obtain S3Bucket & S3Prefix for the File Manager
  const inputS3Url = computed<string | null>(() => labRun.value?.InputS3Url ?? null);
  const s3Bucket = computed<string | null>(
    () => inputS3Url.value?.match(/(?<=^s3:\/\/)([a-z0-9][a-z0-9-]{1,61}[a-z0-9])(?=\/*)/g)?.toString() ?? null,
  );
  const s3Prefix = computed<string | null>(
    () => inputS3Url.value?.match(/(?<=^s3:\/\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/)(.*)/g)?.toString() ?? null,
  );

  const outputPath = computed<string[] | null>(() => {
    const outputS3Url = labRun.value?.OutputS3Url ?? null;
    if (inputS3Url.value === null || outputS3Url === null) return null;

    // get length of shared prefix
    let i = 0;
    while (inputS3Url.value[i] === outputS3Url[i]) i++;

    let outputRelativeLocation = outputS3Url.slice(i);
    if (!outputRelativeLocation.match(/^(\/[^\/]+)+$/)) return null;

    // omics generates an additional sub-folder with the omics run id which we also want to descend into
    if (labRun.value?.Platform === 'AWS HealthOmics' && !!labRun.value?.ExternalRunId) {
      outputRelativeLocation += '/' + labRun.value.ExternalRunId;
    }

    return outputRelativeLocation.split('/').filter((step) => !!step); // filter out blank steps ie ''
  });

  const isLoading = computed<boolean>(() => uiStore.isRequestPending('loadLabRuns'));

  // permission check
  if (!useUserStore().canViewLab(labId)) {
    $router.push('/labs');
  }

  onBeforeMount(async () => {
    await fetchLabRuns();
  });

  async function fetchLabRuns() {
    uiStore.setRequestPending('loadLabRuns');
    try {
      await runStore.loadLabRunsForLab(labId);
    } finally {
      uiStore.setRequestComplete('loadLabRuns');
    }
  }

  const tabItems = computed(() => [
    { key: 'runDetails', label: 'Run Details' },
    { key: 'fileManager', label: 'File Manager' },
  ]);
  const tabIndex = ref(0);

  function setTabIndexFromQuery() {
    const queryTabMatchIndex = tabItems.value.findIndex((tab) => tab.label === $route.query.tab);
    tabIndex.value = queryTabMatchIndex !== -1 ? queryTabMatchIndex : 0;
  }

  onMounted(setTabIndexFromQuery);

  const updateQueryParams = useDebounceFn((params: Record<string, string | undefined>) => {
    $router.replace({ path: $route.path, query: { ...$route.query, ...params } });
  }, 300);

  function handleTabChange(newIndex: number) {
    tabIndex.value = newIndex;
    updateQueryParams({ tab: tabItems.value[newIndex]?.label });
  }

  const pipelineOrWorkflow = computed<string | null>(() =>
    !labRun.value?.Platform ? null : platformToPipelineOrWorkflow(labRun.value.Platform),
  );

  async function downloadSampleSheet(): Promise<void> {
    const sampleSheetUrl = labRun.value?.SampleSheetS3Url;
    if (!sampleSheetUrl) {
      useToastStore().error('Sample Sheet url not available');
      return;
    }

    const path = sampleSheetUrl.replace(/\/[^/]+$/, '');
    const fileName = sampleSheetUrl.split('/').at(-1);

    uiStore.setRequestPending('downloadSampleSheet');
    try {
      await handleS3Download(labId, fileName!, path);
    } finally {
      uiStore.setRequestComplete('downloadSampleSheet');
    }
  }

  const rowStyle = 'flex border-b p-6 text-sm';
  const rowLabelStyle = 'w-[200px] font-medium text-black';
  const rowContentStyle = 'text-muted text-left';

  // Note: the UTabs :ui attribute has to be defined locally in this file - if it is imported from another file,
  //  Tailwind won't pick up and include the classes used and styles will be missing.
  // To keep the tab styling consistent throughout the app, any changes made here need to be duplicated to all other
  //  UTabs that use an "EGTabsStyles" as input to the :ui attribute.
  const EGTabsStyles = {
    base: 'focus:outline-none',
    list: {
      base: '!flex rounded-none mb-6 mt-0',
      padding: 'p-0',
      height: 'h-14',
      marker: {
        background: '',
        shadow: '',
      },
      tab: {
        base: 'font-serif w-auto mr-3 rounded-xl border border-solid',
        background: '',
        active: 'text-white bg-primary border-primary',
        inactive: 'font-serif text-text-body border-background-dark-grey',
        height: '',
        padding: 'px-5 py-2',
        size: 'text-sm',
      },
    },
  };
</script>

<template>
  <EGPageHeader
    :title="labRun?.RunName || ''"
    :description="labRun?.WorkflowName || ''"
    :show-back="true"
    :back-action="() => $router.push(`/labs/${labId}?tab=Lab Runs`)"
    :is-loading="isLoading"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
    show-org-breadcrumb
    show-lab-breadcrumb
    :breadcrumbs="[labRun?.RunName]"
  />

  <UTabs :ui="EGTabsStyles" v-model="tabIndex" :items="tabItems" @update:model-value="handleTabChange">
    <template #item="{ item }">
      <!-- Run Details -->
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
          <dl class="mt-4 space-y-0">
            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Run Name</dt>
              <dd :class="rowContentStyle">{{ labRun.RunName }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">{{ pipelineOrWorkflow }}</dt>
              <dd :class="rowContentStyle">{{ labRun.WorkflowName }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">{{ pipelineOrWorkflow }} Run Status</dt>
              <dd :class="rowContentStyle">
                <EGStatusChip :status="labRun?.Status" />
              </dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Platform</dt>
              <dd :class="rowContentStyle">{{ labRun.Platform }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Owner</dt>
              <dd :class="rowContentStyle">{{ labRun.Owner }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Internal Run Id</dt>
              <dd :class="rowContentStyle">{{ labRun.RunId }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">External Run Id</dt>
              <dd :class="rowContentStyle">{{ labRun.ExternalRunId }}</dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Sample Sheet</dt>
              <dd :class="rowContentStyle" style="width: 90%">
                <EGS3SampleSheetBar
                  :url="labRun.SampleSheetS3Url"
                  :lab-id="labId"
                  :lab-name="lab.labName"
                  :pipeline-or-workflow-name="labRun.WorkflowName"
                  :platform="labRun.Platform"
                  :run-name="labRun.RunName"
                  :display-label="false"
                />
              </dd>
            </div>

            <div :class="rowStyle">
              <dt :class="rowLabelStyle">Created</dt>
              <dd :class="rowContentStyle">{{ `${getTime(labRun.CreatedAt)} ⋅ ${getDate(labRun.CreatedAt)}` }}</dd>
            </div>

            <div :class="rowStyle" v-if="labRun.ModifiedAt">
              <dt :class="rowLabelStyle">Last Modified</dt>
              <dd :class="rowContentStyle">
                {{ `${getTime(labRun.ModifiedAt)} ⋅ ${getDate(labRun.ModifiedAt)}` }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <!-- File Manager -->
      <div v-if="item.key === 'fileManager'" class="space-y-3">
        <EGFileExplorer :lab-id="labId" :s3-bucket="s3Bucket" :s3-prefix="s3Prefix" />
      </div>
    </template>
  </UTabs>
</template>
