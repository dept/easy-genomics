<script setup lang="ts">
  // Organizations are picked on the Organizations and labs page; system admins never land here
  // because the auth guard rewrites their routes to /admin/orgs.
  await navigateTo('/labs', { replace: true });
</script>

<template></template>
