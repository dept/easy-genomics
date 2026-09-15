<script setup lang="ts">
  const $router = useRouter();
  const $route = useRoute();

  const userStore = useUserStore();

  const orgId = computed(() => $route.params.orgId as string);
  const canManageOrg = computed(() => userStore.canManageOrg(orgId.value));

  // Sync + v-if: prevents EGOrgView from mounting (and fetching members) before redirect
  if (!canManageOrg.value) {
    $router.push({ path: '/' });
  }
</script>

<template>
  <EGOrgView v-if="canManageOrg" :org-id="orgId" :org-admin="userStore.isOrgAdminForOrg(orgId)" />
</template>
