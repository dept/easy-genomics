<script setup lang="ts">
  import { LabDetailsFormModeEnum } from '@FE/types/labs';

  const router = useRouter();

  // only allow org admins to access this page
  if (!useUserStore().canCreateLab()) {
    router.push({ path: '/labs' });
  }

  usePageTitle('Create lab');
</script>

<template>
  <div class="w-full">
    <EGPageHeader title="Create a new lab" :back-action="() => router.push({ path: '/labs' })" show-back />
  </div>

  <EGFormLabDetails :form-mode="LabDetailsFormModeEnum.enum.Create" />
</template>
