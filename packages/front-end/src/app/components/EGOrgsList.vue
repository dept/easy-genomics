<script setup lang="ts">
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';

  const props = defineProps<{
    superuser?: boolean;
  }>();

  const emit = defineEmits<{
    /** Row click — select org and open Labs for that org (org admins) */
    (event: 'select-org', org: Organization): void;
    /** Action menu — open org management after switching context */
    (event: 'manage-org', org: Organization): void;
    /** @deprecated Use select-org / manage-org; kept for superuser admin list */
    (event: 'click-org', org: Organization): void;
  }>();

  const { $api } = useNuxtApp();
  const $router = useRouter();

  const orgsStore = useOrgsStore();

  onBeforeMount(loadOrgs);

  // table data stuff
  const isLoading = ref(false);
  const orgsDisplayList = computed<Organization[]>(() =>
    Object.values(orgsStore.orgs).sort((orgA, orgB) => useSort().stringSortCompare(orgA.Name, orgB.Name)),
  );

  async function loadOrgs() {
    isLoading.value = true;
    try {
      await orgsStore.loadOrgs();
    } catch (error) {
      console.error(error);
      useToastStore().error('Something went wrong while loading Organizations');
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  const tableColumns = [
    {
      key: 'Name',
      label: 'Name',
      sortable: true,
      sort: useSort().stringSortCompare,
    },
    {
      key: 'Description',
      label: 'Description',
    },
    {
      key: 'actions',
      label: '',
    },
  ];

  function actionItems(org: Organization): object[] {
    const items: object[] = [
      [
        {
          label: 'View / Edit',
          click: async () => manageOrg(org),
        },
      ],
    ];

    if (props.superuser) {
      items.push([
        {
          label: 'Remove',
          class: 'text-alert-danger-dark',
          click: () => {
            orgToRemove.value = org;
            isRemoveOrgDialogOpen.value = true;
          },
        },
      ]);
    }

    return items;
  }

  function selectOrg(org: Organization) {
    if (props.superuser) {
      emit('click-org', org);
    } else {
      emit('select-org', org);
    }
  }

  function manageOrg(org: Organization) {
    if (props.superuser) {
      emit('click-org', org);
    } else {
      emit('manage-org', org);
    }
  }

  // delete org stuff
  const isRemoveOrgDialogOpen = ref<boolean>(false);
  const orgToRemove = ref<Organization | null>(null);

  const removeOrgModalMessage = computed<string>(() => {
    return `Are you sure you want to remove organization '${orgToRemove.value?.Name}'?`;
  });

  async function handleDeleteOrg() {
    // double check
    if (!props.superuser) {
      return;
    }

    try {
      await $api.orgs.remove(orgToRemove.value?.OrganizationId!);
      useToastStore().success('Organization deleted');
    } catch (error) {
      console.error(error);
      useToastStore().error('Something went wrong while removing the Organization');
      throw error;
    } finally {
      isLoading.value = false;
    }

    isRemoveOrgDialogOpen.value = false;

    await loadOrgs();
  }
</script>

<template>
  <EGPageHeader title="Organizations" :show-back="false">
    <EGButton v-if="superuser" label="Create a new Organization" to="/orgs/create" />
  </EGPageHeader>

  <EGTable
    :row-click-action="selectOrg"
    :table-data="orgsDisplayList"
    :columns="tableColumns"
    :is-loading="isLoading"
    :action-items="actionItems"
    :show-pagination="!isLoading"
  />

  <EGDialog
    actionLabel="Remove Organization"
    :actionVariant="ButtonVariantEnum.enum.destructive"
    cancelLabel="Cancel"
    :cancelVariant="ButtonVariantEnum.enum.secondary"
    @action-triggered="handleDeleteOrg"
    :primaryMessage="removeOrgModalMessage"
    v-model="isRemoveOrgDialogOpen"
  />
</template>
