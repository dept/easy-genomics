<script setup lang="ts">
  // The code exchange is a side effect of the module signInWithRedirect pulls
  // in, so it only runs if that module reaches this route's bundle. It does
  // today via the shared chunk, but if it ever stops, the ?code= param is
  // silently never exchanged — and only in production builds, not dev. AWS
  // documents this import as the safeguard for multi-page apps.
  import 'aws-amplify/auth/enable-oauth-listener';
  import { fetchAuthSession } from 'aws-amplify/auth';

  definePageMeta({
    layout: 'empty',
  });

  onMounted(async () => {
    try {
      // Blocks on the in-flight OAuth exchange before reading tokens, so this
      // resolves only once the redirect has actually been completed.
      const { tokens } = await fetchAuthSession();

      if (!tokens?.idToken) {
        throw new Error('OAuth callback completed without a session');
      }

      await useUser().setCurrentUserDataFromToken();
      await useOrgsStore().loadOrgs();
      await navigateTo('/');
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
