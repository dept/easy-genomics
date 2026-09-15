<script setup lang="ts">
  const routeKey = ref(0);

  const { setCurrentUserDataFromToken } = useUser();
  const hasInit = ref(false);
  const uiStore = useUiStore();
  const route = useRoute();
  const isFullWidthContent = computed(() => Boolean(route.meta.fullWidthContent));

  // Basic shell responsiveness: collapse the sidebar on narrower viewports so content isn't crushed.
  const NARROW_SHELL_MQ = '(max-width: 1024px)';
  let narrowShellMql: MediaQueryList | null = null;

  function syncSidebarToViewport(matchesNarrow: boolean) {
    if (matchesNarrow) {
      uiStore.setSidebarCollapsed(true);
    }
  }

  function onNarrowShellChange(event: MediaQueryListEvent) {
    syncSidebarToViewport(event.matches);
  }

  /**
   * @description Initialize the app for authed users; set the current user's organization with
   * future scope to add user display details (name, email, etc.)
   */
  onBeforeMount(async () => {
    await setCurrentUserDataFromToken();
    hasInit.value = true;
  });

  onMounted(() => {
    if (typeof window === 'undefined') {
      return;
    }
    narrowShellMql = window.matchMedia(NARROW_SHELL_MQ);
    syncSidebarToViewport(narrowShellMql.matches);
    narrowShellMql.addEventListener('change', onNarrowShellChange);
  });

  onBeforeUnmount(() => {
    narrowShellMql?.removeEventListener('change', onNarrowShellChange);
    narrowShellMql = null;
  });

  watch(routeKey, () => {
    routeKey.value++;
  });
</script>

<template>
  <EGToasts class="top-[52px]" />
  <EGHeader :is-authed="true" key="routeKey" />
  <main
    class="mb-4 mt-6 px-4"
    :class="{
      'has-sidebar': uiStore.hasSidebar,
      'has-sidebar--collapsed': uiStore.hasSidebar && uiStore.sidebarCollapsed,
      'is-full-width-content': isFullWidthContent,
    }"
  >
    <slot v-if="hasInit" />
  </main>
</template>

<style scoped lang="scss">
  main {
    max-width: var(--max-page-container-width-px);
    margin-left: max(1rem, calc((100% - var(--max-page-container-width-px)) / 3));
    margin-right: auto;

    &.is-full-width-content {
      max-width: none;
      width: calc(100% - 2 * var(--sidebar-content-gap));
      margin-left: var(--sidebar-content-gap);
      margin-right: var(--sidebar-content-gap);
    }

    &.has-sidebar {
      position: relative;
      max-width: none;
      width: calc(100% - var(--sidebar-width) - 2 * var(--sidebar-content-gap));
      margin-left: calc(var(--sidebar-width) + var(--sidebar-content-gap));
      margin-right: var(--sidebar-content-gap);
      transition:
        margin-left 0.2s ease,
        width 0.2s ease;

      &.has-sidebar--collapsed {
        width: calc(100% - var(--sidebar-width-collapsed) - 2 * var(--sidebar-content-gap));
        margin-left: calc(var(--sidebar-width-collapsed) + var(--sidebar-content-gap));
      }
    }
  }

  @media (max-width: 1024px) {
    main.has-sidebar:not(.has-sidebar--collapsed) {
      // Prefer the collapsed content gutter when the viewport is narrow even if the
      // sidebar is temporarily expanded, so the main column does not overflow.
      width: calc(100% - var(--sidebar-width-collapsed) - 2 * var(--sidebar-content-gap));
      margin-left: calc(var(--sidebar-width-collapsed) + var(--sidebar-content-gap));
    }
  }
</style>
