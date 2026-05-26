<script setup lang="ts">
  import { getDate, getTime } from '@FE/utils/date-time';
  import { useLabsStore, useRunStore } from '@FE/stores';
  import { useDebounceFn } from '@vueuse/core';

  const { $api } = useNuxtApp();
  const $router = useRouter();
  const $route = useRoute();
  const runStore = useRunStore();
  const labsStore = useLabsStore();

  const labId = $route.params.labId as string;
  const seqeraRunId = $route.params.seqeraRunId as string;

  const seqeraRunReports = ref([]);
  const tabIndex = ref(0);

  if (!useUserStore().canViewLab(labId)) {
    $router.push('/labs');
  }

  const labRunId = computed<string | null>(() => runStore.labRunByExternalId(seqeraRunId)?.RunId ?? null);
  const s3Bucket = computed<string>(() => labsStore.labs[labId]?.S3Bucket ?? '');
  const s3Prefix = computed<string>(() => `${useUserStore().currentOrgId}/${labId}/next-flow/${labRunId.value ?? ''}`);
  const tabItems = computed(() => [
    { key: 'runDetails', label: 'Run Details' },
    { key: 'fileManager', label: 'File Manager' },
  ]);
  const seqeraRun = computed(() => runStore.seqeraRuns[labId]?.[seqeraRunId] || null);

  usePageTitle(() => (seqeraRun.value?.runName ? seqeraRun.value.runName : 'Seqera run'));

  const createdDateTime = computed(() => formatDateTime(seqeraRun.value?.dateCreated));
  const startedDateTime = computed(() => formatDateTime(seqeraRun.value?.start));
  const stoppedDateTime = computed(() => formatDateTime(seqeraRun.value?.complete));

  function formatDateTime(date: string | undefined): string {
    const datePart = getDate(date);
    const timePart = getTime(date);
    return datePart && timePart ? `${timePart} ⋅ ${datePart}` : '—';
  }

  function validateAndSetTabIndex(queryTab: string): void {
    const matchedIndex = tabItems.value.findIndex((item) => item.label === queryTab);
    if (matchedIndex !== -1) {
      tabIndex.value = matchedIndex;
    } else {
      tabIndex.value = 0;
      updateQueryParams({ tab: tabItems.value[0]?.label });
    }
  }

  const updateQueryParams = useDebounceFn((params: Record<string, string | undefined>) => {
    $router.replace({ path: $route.path, query: { ...$route.query, ...params } });
  }, 300);

  onBeforeMount(() => {
    Promise.all([loadRunReports(), fetchLaboratoryRuns(), fetchSeqeraRun()]);
  });

  onMounted(() => {
    validateAndSetTabIndex(($route.query.tab as string) || tabItems.value[0]?.label);
  });

  watch(
    () => $route.query.tab,
    (newTab) => validateAndSetTabIndex(newTab as string),
  );

  async function loadRunReports() {
    useUiStore().setRequestPending('loadRunReports');
    try {
      const res = await $api.seqeraRuns.readWorkflowReports(seqeraRunId, labId);
      seqeraRunReports.value = res.reports || [];
    } finally {
      useUiStore().setRequestComplete('loadRunReports');
    }
  }

  async function fetchLaboratoryRuns(): Promise<void> {
    await runStore.loadLabRunsForLab(labId);
  }

  async function fetchSeqeraRun(): Promise<void> {
    await runStore.loadSingleSeqeraRun(labId, seqeraRunId);
  }

  function handleTabChange(newIndex: number) {
    tabIndex.value = newIndex;
    updateQueryParams({ tab: tabItems.value[newIndex]?.label });
  }
</script>

<template>
  <EGPageHeader
    :title="seqeraRun?.runName || ''"
    :description="seqeraRun?.projectName || ''"
    :show-back="true"
    :back-action="() => $router.push(`/labs/${labId}`)"
    :is-loading="useUiStore().isRequestPending('loadSeqeraRun')"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
    show-org-breadcrumb
    show-lab-breadcrumb
  />

  <EGDetailTabs
    :model-value="tabIndex"
    :items="tabItems"
    aria-label="Seqera run sections"
    @update:model-value="handleTabChange"
  >
    <template #default="{ item }">
      <div v-show="item.key === 'fileManager'" class="space-y-3">
        <EGFileExplorer
          v-if="labRunId && s3Bucket"
          :lab-id="labId"
          :run-id="labRunId"
          :s3-bucket="s3Bucket"
          :s3-prefix="s3Prefix"
        />
      </div>
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
          <h2 class="sr-only">Run details</h2>
          <dl class="mt-4 space-y-4">
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Run Status</dt>
              <dd class="text-muted text-left">
                <EGStatusChip :status="seqeraRun?.status" />
              </dd>
            </div>
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Creation Time</dt>
              <dd class="text-muted text-left">{{ createdDateTime }}</dd>
            </div>
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Start Time</dt>
              <dd class="text-muted text-left">{{ startedDateTime }}</dd>
            </div>
            <div class="flex p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Stop Time</dt>
              <dd class="text-muted text-left">{{ stoppedDateTime }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </EGDetailTabs>
</template>
