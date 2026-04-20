<script setup lang="ts">
  const routeKey = ref(0);

  const { setCurrentUserDataFromToken } = useUser();
  const hasInit = ref(false);
  const uiStore = useUiStore();

  /**
   * @description Initialize the app for authed users; set the current user's organization with
   * future scope to add user display details (name, email, etc.)
   */
  onBeforeMount(async () => {
    await setCurrentUserDataFromToken();
    hasInit.value = true;
  });

  watch(routeKey, () => {
    routeKey.value++;
  });
</script>

<template>
  <EGToasts class="top-[52px]" />
  <EGHeader :is-authed="true" key="routeKey" />
  <main class="mb-4 mt-6 px-4" :class="{ 'has-sidebar': uiStore.hasSidebar }">
    <slot v-if="hasInit" />
  </main>
</template>

<style scoped lang="scss">
  main {
    max-width: var(--max-page-container-width-px);
    margin-left: max(1rem, calc((100% - var(--max-page-container-width-px)) / 3));
    margin-right: auto;

    &.has-sidebar {
      position: relative;
      margin-left: calc(var(--sidebar-width) + 2rem);
      margin-right: 2rem;
    }
  }
</style>
