<script setup lang="ts">
  import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';

  const $router = useRouter();
  const { switchTo } = useSwitchOrganization();

  if (!useUserStore().canManageAnyOrgs()) {
    $router.push({ path: '/' });
  }

  async function onSelectOrg(org: Organization): Promise<void> {
    await switchTo(org.OrganizationId, { showToast: false });
    await navigateTo('/');
  }

  async function onManageOrg(org: Organization): Promise<void> {
    await switchTo(org.OrganizationId, { showToast: false });
    await navigateTo(`/orgs/${org.OrganizationId}`);
  }
</script>

<template>
  <EGOrgsList @select-org="onSelectOrg" @manage-org="onManageOrg" />
</template>
