<script setup lang="ts">
  const $route = useRoute();
  const $router = useRouter();

  const labId = $route.params.labId as string;
  const labsStore = useLabsStore();
  const uiStore = useUiStore();
  const userStore = useUserStore();
  const { labTab } = useLabBreadcrumbs(labId);

  // only lab managers and above can create workflows
  if (!userStore.canEditLabUsers(labId)) {
    $router.push('/labs');
  }

  if (!labsStore.labs[labId]) {
    uiStore.setRequestPending('loadLabData');
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
    $router.push(labTab('HealthOmics Workflows'));
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
    :breadcrumbs="[{ label: 'HealthOmics Workflows', to: labTab('HealthOmics Workflows') }, 'Create Workflow']"
  />

  <template v-if="uiStore.isRequestPending('loadLabData')">
    <EGLoadingSpinner />
  </template>

  <EGCreateOmicsWorkflowForm v-else :lab-id="labId" @created="handleWorkflowCreated" @cancelled="backToWorkflowsTab" />
</template>
