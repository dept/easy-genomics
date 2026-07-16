<script setup lang="ts">
  const $router = useRouter();
  const $route = useRoute();

  const userStore = useUserStore();

  const orgId = computed(() => $route.params.orgId as string);

  onMounted(() => {
    if (!userStore.canManageOrg(orgId.value)) {
      $router.push({ path: '/' });
    }
  });
</script>

<template>
  <EGOrgView :org-id="orgId" :org-admin="userStore.isOrgAdminForOrg(orgId)" />
</template>
