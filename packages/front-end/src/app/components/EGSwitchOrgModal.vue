<script setup lang="ts">
  import { ButtonVariantEnum } from '@FE/types/buttons';

  const props = defineProps<{
    switchToOrgId: string | null;
  }>();
  const model = defineModel();

  const $router = useRouter();
  const uiStore = useUiStore();
  const { switchTo } = useSwitchOrganization();

  async function doSwitchOrg(): Promise<void> {
    if (!props.switchToOrgId) {
      return;
    }

    try {
      await switchTo(props.switchToOrgId);
      $router.push('/');
    } catch (e) {
      throw e;
    }
  }
</script>

<template>
  <EGDialog
    cancel-label="Cancel"
    action-label="Continue"
    :action-variant="ButtonVariantEnum.enum.primary"
    @action-triggered="doSwitchOrg"
    primary-message="Are you sure you would like to switch organizations?"
    secondary-message="You are about to switch organization accounts. Ensure all unsaved work is saved and reviewed before proceeding. Switching accounts may result in losing access to current session data or active tasks."
    :loading="uiStore.isRequestPending('switchOrg')"
    v-model="model"
  />
</template>
