<script setup lang="ts">
  import type { FormSubmitEvent } from '#ui/types';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';
  import { OrgDetailsForm } from '@FE/types/forms';

  const router = useRouter();
  const { $api } = useNuxtApp();

  const $router = useRouter();

  usePageTitle('Create organization');

  async function onSubmit(event: FormSubmitEvent<OrgDetailsForm>) {
    try {
      useUiStore().setRequestPending('createOrg');
      const { Name, Description, NextFlowTowerApiBaseUrl } = event.data;
      await $api.orgs.create({ Name, Description, NextFlowTowerApiBaseUrl });
      useToastStore().success('Organization created');
      router.push({ path: '/admin/orgs' });
    } catch (error) {
      useToastStore().error(VALIDATION_MESSAGES.network);
    } finally {
      useUiStore().setRequestComplete('createOrg');
    }
  }
</script>

<template>
  <div class="w-full">
    <EGPageHeader
      title="Create a new Organization"
      :back-action="() => $router.push({ path: '/admin/orgs' })"
      show-back
    />
    <EGFormOrgDetails @submit-form-org-details="onSubmit($event)" />
  </div>
</template>
