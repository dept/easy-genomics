<script setup lang="ts">
  import { getDate, getTime } from '@FE/utils/date-time';
  import { useRunStore } from '@FE/stores';
  import { RunListItem as OmicsRun } from '@aws-sdk/client-omics';

  const $router = useRouter();
  const $route = useRoute();
  const runStore = useRunStore();

  const labId = $route.params.labId as string;
  const omicsRunId = $route.params.omicsRunId as string;
  const tabIndex = ref(0);

  if (!useUserStore().canViewLab(labId)) {
    $router.push('/labs');
  }

  const tabItems = computed(() => [
    {
      key: 'runDetails',
      label: 'Run Details',
    },
    {
      key: 'fileManager',
      label: 'File Manager',
    },
  ]);

  const omicsRun = computed<OmicsRun | null>(() => runStore.omicsRuns[labId][omicsRunId]);

  usePageTitle(() => (omicsRun.value?.name ? omicsRun.value.name : 'HealthOmics run'));

  const createdDateTime = computed(() => {
    const createdDate = getDate(omicsRun.value?.creationTime as unknown as string);
    const createdTime = getTime(omicsRun.value?.creationTime as unknown as string);
    return createdDate && createdTime ? `${createdTime} ⋅ ${createdDate}` : '—';
  });
  const startedDateTime = computed(() => {
    const startedDate = getDate(omicsRun.value?.startTime as unknown as string);
    const startedTime = getTime(omicsRun.value?.startTime as unknown as string);
    return startedDate && startedTime ? `${startedTime} ⋅ ${startedDate}` : '—';
  });
  const stoppedDateTime = computed(() => {
    const stoppedDate = getDate(omicsRun.value?.stopTime as unknown as string);
    const stoppedTime = getTime(omicsRun.value?.stopTime as unknown as string);
    return stoppedDate && stoppedTime ? `${stoppedTime} ⋅ ${stoppedDate}` : '—';
  });

  onMounted(() => {
    const queryTab = $route.query.tab as string;
    const queryTabMatchIndex = tabItems.value.findIndex((tab) => tab.label === queryTab);
    tabIndex.value = queryTabMatchIndex !== -1 ? queryTabMatchIndex : 0;
  });

  onBeforeMount(async () => await runStore.loadSingleOmicsRun(labId, omicsRunId));

  watch(tabIndex, (index) => {
    if (index === 1) useToastStore().info('Viewing HealthOmics Run results is not yet implemented');
  });

  function handleTabChange(newIndex: number) {
    tabIndex.value = newIndex;
    $router.push({ query: { ...$router.currentRoute.query, tab: tabItems.value[newIndex].label } });
  }
</script>

<template>
  <EGPageHeader
    :title="omicsRun?.name || ''"
    :show-back="true"
    :back-action="() => $router.push(`/labs/${labId}`)"
    :is-loading="useUiStore().isRequestPending('loadOmicsRun')"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
    show-org-breadcrumb
    show-lab-breadcrumb
  />

  <EGDetailTabs
    :model-value="tabIndex"
    :items="tabItems"
    aria-label="HealthOmics run sections"
    @update:model-value="handleTabChange"
  >
    <template #default="{ item }">
      <div v-if="item.key === 'fileManager'" class="space-y-3">
        <p class="text-muted text-sm" role="status">
          Viewing HealthOmics run results in the file manager is not yet implemented.
        </p>
      </div>

      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
          <h2 class="sr-only">Run details</h2>
          <dl class="mt-4">
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Run Status</dt>
              <dd class="text-muted text-left"><EGStatusChip :status="omicsRun.status" /></dd>
            </div>
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Workflow version</dt>
              <dd class="text-muted text-left">{{ omicsRun?.workflowVersionName || '—' }}</dd>
            </div>
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Creation Time</dt>
              <dd class="text-muted text-left">{{ createdDateTime }}</dd>
            </div>
            <div class="flex border-b p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Start Time</dt>
              <dd class="text-muted text-left max-md:max-w-full">{{ startedDateTime }}</dd>
            </div>
            <div class="flex p-4 text-sm">
              <dt class="w-[200px] font-medium text-black">Stop Time</dt>
              <dd class="text-muted text-left max-md:max-w-full">{{ stoppedDateTime }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </EGDetailTabs>
</template>
