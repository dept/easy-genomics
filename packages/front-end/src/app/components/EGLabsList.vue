<script setup lang="ts">
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { DeletedResponse } from '@FE/types/api';

  const props = defineProps<{
    superuser?: boolean;
    orgId: string;
  }>();

  const { $api } = useNuxtApp();
  const router = useRouter();
  const labsStore = useLabsStore();

  const labsDisplayList = computed<Laboratory[]>(() =>
    labsStore.labsForOrg(props.orgId).sort((labA, labB) => useSort().stringSortCompare(labA.Name, labB.Name)),
  );
  const hasNoData = computed<boolean>(
    () => labsDisplayList.value.length === 0 && !useUiStore().isRequestPending('getLabs'),
  );

  // fetch lab data into store
  onBeforeMount(getLabs);

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
      label: 'Actions',
    },
  ];

  function actionItems(lab: Laboratory) {
    const items: object[] = [
      [
        {
          label: 'View / Edit',
          click: () => onRowClicked(lab),
        },
      ],
    ];

    if (!useUserStore().isSuperuser && useUserStore().canDeleteLab()) {
      items.push([
        {
          label: 'Remove',
          class: 'text-alert-danger-dark',
          isHighlighted: true,
          click: () => deleteLab(lab.LaboratoryId, lab.Name),
        },
      ]);
    }

    return items;
  }

  // Dynamic delete lab dialog values
  const isOpen = ref(false);
  const primaryMessage = ref('');
  const selectedId = ref('');
  const displayName = ref('');

  function onRowClicked(row: Laboratory) {
    if (props.superuser) {
      router.push({ path: `/admin/orgs/${props.orgId}/labs/${row.LaboratoryId}` });
    } else {
      router.push({ path: `/labs/${row.LaboratoryId}` });
    }
  }

  function resetSelectedLabValues() {
    selectedId.value = '';
    displayName.value = '';
    primaryMessage.value = '';
  }

  async function deleteLab(labId: string, labName: string) {
    selectedId.value = labId;
    displayName.value = labName;
    primaryMessage.value = `Are you sure you want to remove lab '${labName}'?`;
    isOpen.value = true;
  }

  async function handleDeleteLab() {
    try {
      useUiStore().setRequestPending('deleteLab');
      isOpen.value = false;

      if (!selectedId.value) {
        throw new Error('No selectedId');
      }

      const res: DeletedResponse = await $api.labs.delete(selectedId.value);

      if (res?.Status !== 'Success') {
        throw new Error('Lab not removed');
      }

      useToastStore().success(`Lab '${displayName.value}' has been removed`);
      await getLabs();
    } catch (error) {
      useToastStore().error(`Failed to remove lab '${displayName.value}'`);
      throw error;
    } finally {
      useUiStore().setRequestComplete('deleteLab');
      resetSelectedLabValues();
    }
  }

  async function getLabs() {
    useUiStore().setRequestPending('getLabs');
    try {
      await labsStore.loadLabsForOrg(props.orgId);
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('getLabs');
    }
  }
</script>

<template>
  <EGEmptyDataCTA
    v-if="hasNoData"
    message="You don't have any Labs set up yet."
    :primary-button-action="useUserStore().canCreateLab() ? () => $router.push({ path: `/labs/create` }) : null"
    :primary-button-label="useUserStore().canCreateLab() ? 'Create a new Lab' : null"
  />

  <EGTable
    :row-click-action="onRowClicked"
    v-else
    :table-data="labsDisplayList"
    :columns="tableColumns"
    :is-loading="useUiStore().anyRequestPending(['getLabs', 'deleteLab'])"
    :action-items="actionItems"
    :show-pagination="!useUiStore().anyRequestPending(['getLabs', 'deleteLab']) && !hasNoData"
  />

  <EGDialog
    actionLabel="Remove Lab"
    :actionVariant="ButtonVariantEnum.enum.destructive"
    cancelLabel="Cancel"
    :cancelVariant="ButtonVariantEnum.enum.secondary"
    @action-triggered="handleDeleteLab"
    :primaryMessage="primaryMessage"
    v-model="isOpen"
  />
</template>
