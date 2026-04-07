<script setup lang="ts">
  const $router = useRouter();
  const $route = useRoute();

  const userStore = useUserStore();
  const orgId = $route.params.orgId as string;

  if (!userStore.canManageOrg(orgId)) {
    $router.push({ path: '/' });
  }

  const backPath = `/orgs/${orgId}`;
</script>

<template>
  <EGWorkflowLabAccessPage :org-id="orgId" :back-path="backPath" />
</template>
