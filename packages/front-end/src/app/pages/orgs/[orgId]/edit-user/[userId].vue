<script setup lang="ts">
  const $router = useRouter();
  const $route = useRoute();

  const orgId = $route.params.orgId as string;
  const userId = $route.params.userId as string;

  onBeforeMount(() => {
    if (!useUserStore().canManageOrg(orgId)) {
      $router.replace({ path: '/' });
    } else {
      $router.replace({ path: `/orgs/${orgId}`, query: { openUser: userId } });
    }
  });
</script>

<template></template>

<style scoped></style>
