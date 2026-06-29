<script setup lang="ts">
  import tailwindConfig from '../../tailwind.config.js';
  import { useNetwork } from '@vueuse/core';

  const primaryColHex = tailwindConfig.theme.extend.colors.primary;
  const { ENV_TYPE } = useRuntimeConfig().public;
  const { isOnline } = useNetwork();
</script>

<template>
  <NuxtLoadingIndicator :color="primaryColHex" />
  <EGOfflineModal :model-value="!isOnline" />
  <EGConsentBanner />
  <NuxtLayout :key="useUiStore().remountAppKey">
    <NuxtPage />
    <EGBuildInfo v-if="ENV_TYPE !== 'prod'" />
  </NuxtLayout>
  <UModals />
</template>

<style lang="scss">
  body {
    background-color: #f5f5f5;
    @apply text-body;
  }

  .page-enter-active,
  .page-leave-active {
    transition: all 0.4s;
  }
  .page-enter-from,
  .page-leave-to {
    opacity: 0;
    filter: blur(1rem);
  }

  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }

  .fade-enter-to,
  .fade-leave-from {
    opacity: 1;
  }

  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.3s;
  }
  .fade-enter-active {
    transition-delay: 0.3s;
  }
</style>
