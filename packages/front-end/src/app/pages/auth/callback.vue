<script setup lang="ts">
  import { Auth } from 'aws-amplify';
  import { decodeJwt } from '@FE/utils/jwt-utils';

  definePageMeta({
    layout: 'empty',
  });

  onMounted(async () => {
    try {
      // This completes the OAuth code exchange internally
      const user = await Auth.currentAuthenticatedUser();

      if (user) {
        try {
          await useUser().setCurrentUserDataFromToken();
          await useOrgsStore().loadOrgs();
        } catch (dataError) {
          console.error('Error setting user data:', dataError);
        }
        // Get default lab from token and redirect accordingly
        const token = await useAuth().getToken();
        const decodedToken: any = decodeJwt(token);
        const defaultLab = decodedToken.DefaultLaboratory;
        if (defaultLab) {
          await navigateTo(`/labs/${defaultLab}`);
        } else {
          await navigateTo('/labs');
        }
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
