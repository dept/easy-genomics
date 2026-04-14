<script setup lang="ts">
  const $router = useRouter();

  const userStore = useUserStore();

  onMounted(() => {
    if (userStore.isSuperuser) {
      $router.push('/orgs');
    } else {
      let dest = '/labs';

      if (userStore.mostRecentLabId !== null) {
        dest += `/${userStore.mostRecentLabId}?tab=Dashboard`;
      }

      $router.push(dest);
    }
  });
</script>

<template></template>
