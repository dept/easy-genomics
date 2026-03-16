<script setup lang="ts">
  import { Auth } from 'aws-amplify';

  definePageMeta({
    layout: 'empty',
  });

  onMounted(async () => {
    try {
      // This completes the OAuth code exchange internally
      const user = await Auth.currentAuthenticatedUser();

      if (user) {
        await useUser().setCurrentUserDataFromToken();
        await useOrgsStore().loadOrgs();
        await navigateTo('/');
      }
    } catch (error) {
      console.error('OAuth callback error:', error);
      await navigateTo('/signin');
    }
  });
</script>

<template>
  <div class="flex h-screen items-center justify-center">
    <span>Signing you in…</span>
  </div>
</template>
