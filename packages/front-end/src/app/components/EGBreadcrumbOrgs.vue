<script setup lang="ts">
  import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';

  const route = useRoute();

  const orgsStore = useOrgsStore();
  const userStore = useUserStore();

  const isOpen = ref<boolean>(false);

  const currentOrg = computed<Organization | null>(() => {
    // for superuser, use the org in the url; for normal user, currentOrgId
    const currentOrgId = userStore.isSuperuser ? (route.params.orgId as string) : userStore.currentOrgId;
    return orgsStore.orgs[currentOrgId || ''] || null;
  });

  const otherOrgs = computed<Organization[]>(() => {
    // the superuser can't "switch" orgs so don't offer any
    if (userStore.isSuperuser) return [];

    return Object.values(orgsStore.orgs)
      .filter((org) => org.OrganizationId !== userStore.currentOrgId)
      .sort((a, b) => useSort().stringSortCompare(a.Name, b.Name));
  });

  const items = computed<Organization[][]>(() =>
    otherOrgs.value.map((org) => [
      {
        ...org,
        click: () => selectSwitchToOrg(org.OrganizationId),
      },
    ]),
  );

  const switchToOrgId = ref<string | null>(null);
  const switchOrgDialogOpen = ref<boolean>(false);

  function selectSwitchToOrg(orgId: string): void {
    switchToOrgId.value = orgId;
    switchOrgDialogOpen.value = true;
  }
</script>

<template>
  <div>
    <UDropdown v-model:open="isOpen" :items="items" :popper="{ placement: 'bottom-start' }">
      <span
        class="font-schibsted text-body inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm"
        :aria-label="
          items.length > 0
            ? `Organization: ${currentOrg?.Name}. Switch organization`
            : `Organization: ${currentOrg?.Name}`
        "
      >
        {{ currentOrg?.Name }}
        <UIcon v-if="items.length > 0" name="i-heroicons-chevron-up-down" class="h-4 w-4 shrink-0" aria-hidden="true" />
      </span>
      <template #item="{ item }">
        <span class="w-full text-left">{{ item.Name }}</span>
      </template>
    </UDropdown>
  </div>

  <EGSwitchOrgModal v-model="switchOrgDialogOpen" :switch-to-org-id="switchToOrgId" />
</template>
