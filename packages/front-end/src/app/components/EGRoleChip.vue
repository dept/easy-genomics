<script setup lang="ts">
  import { currentOrgRole } from '@FE/utils/current-org-role';

  const userStore = useUserStore();

  const role = computed(() =>
    currentOrgRole(userStore.isSuperuser, userStore.currentUserPermissions.orgPermissions, userStore.currentOrgId),
  );

  const chipUi = {
    base: 'inline-flex items-center whitespace-nowrap',
    rounded: 'rounded-xl',
    font: 'font-medium',
    size: { sm: 'text-xs px-3 py-1' },
    variant: { solid: 'bg-primary-muted text-primary-dark' },
  };
</script>

<template>
  <UBadge v-if="role" size="sm" variant="solid" :ui="chipUi">{{ role }}</UBadge>
</template>
