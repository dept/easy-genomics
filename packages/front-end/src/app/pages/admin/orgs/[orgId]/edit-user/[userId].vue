<script setup lang="ts">
  const $router = useRouter();
  const $route = useRoute();

  onBeforeMount(() => {
    $router.replace({
      path: `/admin/orgs/${$route.params.orgId}`,
      query: { openUser: $route.params.userId as string },
    });
  });
</script>

<template></template>
