<script setup lang="ts">
  const $route = useRoute();
  const $router = useRouter();

  const labId = computed(() => $route.params.labId as string);
  const initialTab = computed(() => ($route.query.tab as string | undefined) ?? undefined);

  // check permissions to be on this page
  if (!useUserStore().canViewLab(labId.value)) {
    $router.push('/labs');
  }
</script>

<template>
  <EGLabView :lab-id="labId" :initial-tab="initialTab" />
</template>
