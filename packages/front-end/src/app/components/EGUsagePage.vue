<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      orgId: string;
      orgName: string;
      headingId?: string;
      initialTab?: string;
    }>(),
    {
      headingId: 'usage-heading',
      initialTab: 'limits',
    },
  );

  const tabItems = [
    { key: 'limits', label: 'Limits' },
    { key: 'run-costs', label: 'Run costs' },
  ];

  function tabIndexFor(key: string): number {
    return Math.max(
      0,
      tabItems.findIndex((item) => item.key === key),
    );
  }

  const tabIndex = ref(tabIndexFor(props.initialTab));
  /** UTabs keeps every panel rendered, so each sub-tab mounts (and fetches) the first time it is opened. */
  const openedTabKeys = ref(new Set([tabItems[tabIndex.value].key]));

  watch(tabIndex, (index) => {
    openedTabKeys.value = new Set([...openedTabKeys.value, tabItems[index].key]);
  });

  watch(
    () => props.initialTab,
    (key) => {
      tabIndex.value = tabIndexFor(key);
    },
  );
</script>

<template>
  <div class="flex flex-col gap-4">
    <EGText :id="props.headingId" tag="h2">Usage</EGText>

    <EGDetailTabs v-model="tabIndex" :items="tabItems" aria-label="Usage sections">
      <template #default="{ item }">
        <EGUsageLimitsPage v-if="item.key === 'limits' && openedTabKeys.has('limits')" :org-id="props.orgId" />
        <EGRunCostsPage
          v-else-if="item.key === 'run-costs' && openedTabKeys.has('run-costs')"
          :org-id="props.orgId"
          :org-name="props.orgName"
        />
      </template>
    </EGDetailTabs>
  </div>
</template>
