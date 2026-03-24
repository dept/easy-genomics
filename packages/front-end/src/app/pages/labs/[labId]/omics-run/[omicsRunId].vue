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

  // check permissions to be on this page
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

  // re: `as unknown as string` below: the schema for these time variables specifies `Date | undefined`, but we are
  // receiving strings - this must be a mistake somewhere but for now we're casting them to the actual type

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

  // set tabIndex according to query param
  onMounted(() => {
    const queryTab = $route.query.tab as string;
    const queryTabMatchIndex = tabItems.value.findIndex((tab) => tab.label === queryTab);
    tabIndex.value = queryTabMatchIndex !== -1 ? queryTabMatchIndex : 0;
  });

  // load this particular run into the cache in case it wasn't already loaded by the lab page
  onBeforeMount(async () => await runStore.loadSingleOmicsRun(labId, omicsRunId));

  watch(tabIndex, (index) => {
    if (index === 1) useToastStore().info('Viewing HealthOmics Run results is not yet implemented');
  });

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
    :title="omicsRun?.name || ''"
    :show-back="true"
    :back-action="() => $router.push(`/labs/${labId}`)"
    :is-loading="useUiStore().isRequestPending('loadOmicsRun')"
    :skeleton-config="{ titleLines: 2, descriptionLines: 1 }"
  />

  <UTabs
    :ui="EGTabsStyles"
    :model-value="tabIndex"
    :items="tabItems"
    @update:model-value="
      (newIndex) => {
        $router.push({ query: { ...$router.currentRoute.query, tab: tabItems[newIndex].label } });
        tabIndex = newIndex;
      }
    "
  >
    <template #item="{ item }">
      <div v-if="item.key === 'fileManager'" class="space-y-3"></div>

      <div v-if="item.key === 'runDetails'" class="space-y-3">
        <section
          class="stroke-light flex flex-col rounded-none rounded-b-2xl border border-solid bg-white p-6 pt-0 max-md:px-5"
        >
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
  </UTabs>
</template>
