<script setup lang="ts">
  const $router = useRouter();

  const userStore = useUserStore();
  const labsStore = useLabsStore();

  usePageTitle('Labs');
</script>

<template>
  <EGPageHeader title="Labs" :show-back="false">
    <EGButton
      v-if="userStore.canCreateLab() && labsStore.labsForOrg(userStore.currentOrgId!).length > 0"
      label="Create a new Lab"
      class="self-end"
      @click="() => $router.push({ path: `/labs/create` })"
    />
  </EGPageHeader>

  <EGLabsList :org-id="userStore.currentOrgId" />
</template>
