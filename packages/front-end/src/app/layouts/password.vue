<script setup lang="ts">
  const router = useRouter();
</script>

<template>
  <EGToasts class="top-[52px]" />
  <EGHeader />

  <main class="mx-auto mt-10 flex flex-col justify-center px-4">
    <EGBack label="Return" @click="() => router.push({ path: '/' })" />
    <div class="flex h-[60vh] items-center justify-center">
      <slot />
    </div>
  </main>
</template>

<style scoped lang="scss">
  main {
    max-width: var(--max-page-container-width-px);
  }
</style>
