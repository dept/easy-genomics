<script setup lang="ts">
  // OAuth code exchange is started by plugins/amplify.ts (eager listener import
  // before Amplify.configure). This page only waits for the resulting session.
  definePageMeta({
    layout: 'empty',
  });

  onMounted(async () => {
    try {
      await useAuth().completeOAuthSignIn();
    } catch (error) {
      console.error('OAuth callback error:', error);
      useToastStore().error('Sign-in could not be completed. Please try again.');
      await navigateTo('/signin');
    }
  });
</script>

<template>
  <div class="flex h-screen items-center justify-center">
    <span>Signing you in…</span>
  </div>
</template>
