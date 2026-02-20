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

  // Permission Check
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
      // Default to first tab if invalid
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

  // load this particular run into the cache in case it wasn't already loaded by the lab page
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
  />

  <UTabs :ui="EGTabsStyles" v-model="tabIndex" :items="tabItems" @update:model-value="handleTabChange">
    <template #item="{ item }">
      <div v-show="item.key === 'fileManager'" class="space-y-3">
        <EGFileExplorer v-if="labRunId && s3Bucket" :lab-id="labId" :s3-bucket="s3Bucket" :s3-prefix="s3Prefix" />
      </div>
      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
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
  </UTabs>
</template>
