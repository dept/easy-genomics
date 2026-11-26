<script setup lang="ts">
  import { LabDetailsFormModeEnum } from '@FE/types/labs';

  // Same width mode as Organizations and labs, so the page doesn't shift when you arrive from there.
  definePageMeta({ fullWidthContent: true });

  const router = useRouter();

  // only allow org admins to access this page
  if (!useUserStore().canCreateLab()) {
    router.push({ path: '/labs' });
  }

  usePageTitle('Create lab');

  const backLabel = computed(() => {
    const orgName = useOrgsStore().orgs[useUserStore().currentOrgId ?? '']?.Name;
    return orgName ? `Back to ${orgName}` : 'Back to Organizations and labs';
  });
</script>

<template>
  <div class="mx-auto w-full max-w-[1120px]">
    <EGPageHeader
      title="Create a new lab"
      description="You can change any of this later in the lab's settings."
      :back-button-label="backLabel"
      :back-action="() => router.push({ path: '/labs' })"
      show-back
    />

    <EGFormLabDetails :form-mode="LabDetailsFormModeEnum.enum.Create" />
  </div>
</template>
