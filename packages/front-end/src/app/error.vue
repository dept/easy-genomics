<script setup lang="ts">
  const props = defineProps<{ error: { statusCode: number; message: string } }>();

  async function handleReload() {
    await clearError({ redirect: '/' });
  }
</script>

<template>
  <NuxtLayout>
    <div class="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <h1 class="text-2xl font-semibold text-black">Something went wrong</h1>
      <p class="text-muted max-w-md text-sm">
        An unexpected error occurred. Please reload the page. If the problem persists, contact support.
      </p>
      <EGButton label="Reload" @click="handleReload" />
    </div>
  </NuxtLayout>
</template>
