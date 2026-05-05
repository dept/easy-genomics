<script setup lang="ts">
  const $route = useRoute();
  const $router = useRouter();

  const labId = $route.params.labId as string;
  const labsStore = useLabsStore();
  const uiStore = useUiStore();
  const userStore = useUserStore();

  // check permissions to be on this page
  if (!userStore.canViewLab(labId)) {
    $router.push('/labs');
  }

  onBeforeMount(async () => {
    if (!labsStore.labs[labId]) {
      uiStore.setRequestPending('loadLabData');
      try {
        await labsStore.loadLab(labId);
      } finally {
        uiStore.setRequestComplete('loadLabData');
      }
    }
  });

  const labName = computed<string>(() => labsStore.labs[labId]?.Name || '');

  function backToWorkflowsTab() {
    $router.push(`/labs/${labId}?tab=HealthOmics+Workflows`);
  }

  function handleWorkflowCreated() {
    backToWorkflowsTab();
  }
</script>

<template>
  <EGPageHeader
    title="Create Workflow"
    :description="labName"
    :show-back="true"
    :back-action="backToWorkflowsTab"
    back-button-label="Back to Workflows"
    show-org-breadcrumb
    show-lab-breadcrumb
  />

  <template v-if="uiStore.isRequestPending('loadLabData')">
    <EGLoadingSpinner />
  </template>

  <EGCreateOmicsWorkflowForm v-else :lab-id="labId" @created="handleWorkflowCreated" @cancelled="backToWorkflowsTab" />
</template>
