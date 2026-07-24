<script setup lang="ts">
  import { useToastStore, useUiStore } from '@FE/stores';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { LaboratoryUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user-details';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { DeletedResponse } from '@FE/types/api';
  import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';

  const props = defineProps<{
    orgId: string;
    userId: string;
  }>();

  const { $api } = useNuxtApp();
  const $router = useRouter();

  const selectedUser = ref<OrganizationUserDetails | null>(null);

  const selectedUserNameDetails = computed<NameOptions>(() => ({
    preferredName: selectedUser.value?.PreferredName || null,
    firstName: selectedUser.value?.FirstName || null,
    lastName: selectedUser.value?.LastName || null,
    email: selectedUser.value?.UserEmail || null,
  }));
  const getSelectedUserDisplayName = computed<string>(() => useUser().displayName(selectedUserNameDetails.value));
  const getSelectedUserInitials = computed<string>(() => useUser().initials(selectedUserNameDetails.value));

  const orgAdminToggleId = useId();

  const selectedUserOrgAdmin = computed<boolean | null>(
    () => selectedUser.value?.OrganizationAccess?.[props.orgId]?.OrganizationAdmin ?? null,
  );

  const orgLabsData = ref([] as Laboratory[]);
  const selectedUserLabsData = ref<LaboratoryUserDetails[] | null>(null);
  const isLoading = computed<boolean>(() =>
    useUiStore().anyRequestPending(['updateUser', 'fetchOrgLabs', 'fetchUserLabs']),
  );
  const hasNoData = ref(false);
  const searchOutput = ref('');
  const tableColumns = [
    {
      key: 'Name',
      label: 'Name',
    },
    {
      key: 'actions',
      label: 'Lab Access',
    },
  ];

  type LabIdents = { id: string; name: string };
  const labToRemoveFrom = ref<LabIdents | null>(null);
  const isRemoveUserDialogOpen = ref<boolean>(false);

  onBeforeMount(async () => {
    await Promise.all([fetchOrgLabs(), updateSelectedUser(), fetchUserLabs()]);
  });

  function updateSearchOutput(newVal: string) {
    searchOutput.value = newVal;
  }

  async function updateSelectedUser() {
    try {
      useUiStore().setRequestPending('updateUser');
      const user = await $api.orgs.usersDetailsByUserId(props.userId);

      selectedUser.value = user[0] || null;
    } catch (error) {
      console.error(error);
    } finally {
      useUiStore().setRequestComplete('updateUser');
    }
  }

  async function fetchOrgLabs() {
    try {
      useUiStore().setRequestPending('fetchOrgLabs');
      orgLabsData.value = await $api.labs.list(props.orgId);

      if (!orgLabsData.value.length) {
        hasNoData.value = true;
      }
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('fetchOrgLabs');
    }
  }

  /**
   * Fetch the user's details for each lab
   */
  async function fetchUserLabs() {
    try {
      useUiStore().setRequestPending('fetchUserLabs');
      selectedUserLabsData.value = await $api.labs.listLabUsersByUserId(props.userId);
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('fetchUserLabs');
    }
  }

  /**
   * Filter rows based on search input for laboratory name
   */
  const filteredTableData = computed(() => {
    if (selectedUserLabsData.value === null) {
      // wait till selectedUserLabsData is available to prevent jank as the table reorders the rows in front of the user
      return [];
    }

    return orgLabsData.value
      .filter((lab) => {
        const labName = String(lab.Name).toLowerCase();
        return labName.includes(searchOutput.value.toLowerCase());
      })
      .map((lab) => {
        const hasAccess =
          selectedUser.value?.OrganizationAccess?.[lab.OrganizationId]?.LaboratoryAccess?.[lab.LaboratoryId]?.Status ===
          'Active';
        const labUser = selectedUserLabsData.value.find((user) => user.LaboratoryId === lab.LaboratoryId);

        return {
          labAccessOptionsEnabled: hasAccess,
          access: !hasAccess,
          assignedRole: labUser?.LabManager ? 'Lab Manager' : labUser?.LabTechnician ? 'Lab Technician' : 'Unknown',
          LabManager: labUser?.LabManager || false,
          LabTechnician: labUser?.LabTechnician || false,
          Name: lab.Name,
          LaboratoryId: lab.LaboratoryId,
        };
      })
      .sort((labA, labB) => {
        // Lab Manager labs first
        if (labA.LabManager && !labB.LabManager) return -1;
        if (!labA.LabManager && labB.LabManager) return 1;
        // then Lab Technician
        if (labA.LabTechnician && !labB.LabTechnician) return -1;
        if (!labA.LabTechnician && labB.LabTechnician) return 1;
        // then sort by name
        return useSort().stringSortCompare(labA.Name, labB.Name);
      });
  });

  async function handleAddUser(lab: { labId: string; name: string }) {
    try {
      useUiStore().setRequestPending('addUserToLab');
      useUiStore().setRequestPending(`addUserToLabButton-${props.userId}-${lab.labId}`);

      const res = await $api.labs.addLabUser(lab.labId, props.userId);

      if (res?.Status === 'Success') {
        await updateSelectedUser();
        await fetchUserLabs();
        useToastStore().success(`${lab.name} has been successfully updated for ${getSelectedUserDisplayName.value}`);
      } else {
        throw new Error('Failed to update lab access');
      }
    } catch (error) {
      useToastStore().error(
        "Oops, we couldn't update the lab access. Please check your connection and try again later",
      );
      throw error;
    } finally {
      useUiStore().setRequestComplete('addUserToLab');
      useUiStore().setRequestComplete(`addUserToLabButton-${props.userId}-${lab.labId}`);
    }
  }

  async function handleAssignRole(user: LaboratoryUserDetails) {
    try {
      useUiStore().setRequestPending('assignLabRole');
      const res = await $api.labs.editUserLabAccess(user.LaboratoryId, props.userId, user.LabManager);
      if (res?.Status === 'Success') {
        await fetchUserLabs();
        let maybeLabName = 'Lab';
        const lab = orgLabsData.value.find((lab) => lab.LaboratoryId === user.LaboratoryId);
        if (lab) {
          maybeLabName = lab.Name;
        }
        useToastStore().success(
          `${maybeLabName} has been successfully updated for ${getSelectedUserDisplayName.value}`,
        );
      } else {
        throw new Error('Failed to update user role');
      }
    } catch (error) {
      useToastStore().error(`Failed to update ${getSelectedUserDisplayName.value}`);
      throw error;
    } finally {
      // update UI with latest data
      useUiStore().setRequestComplete('assignLabRole');
    }
  }

  function showRemoveUserDialog(lab: LabIdents) {
    labToRemoveFrom.value = lab;
    isRemoveUserDialogOpen.value = true;
  }

  async function handleRemoveUserFromLab() {
    const labName = labToRemoveFrom.value?.name;
    const labId = labToRemoveFrom.value?.id!;
    isRemoveUserDialogOpen.value = false;

    const displayName = getSelectedUserDisplayName.value;

    try {
      useUiStore().setRequestPending('removeUserFromLab');

      const res: DeletedResponse = await $api.labs.removeUser(labId, props.userId);

      if (res?.Status !== 'Success') {
        throw new Error(`Failed to remove ${displayName} from ${labName}`);
      }

      useToastStore().success(`Successfully removed ${displayName} from ${labName}`);
    } catch (error) {
      useToastStore().error(`Failed to remove ${displayName} from ${labName}`);
    } finally {
      await Promise.all([updateSelectedUser(), fetchUserLabs()]);
      useUiStore().setRequestComplete('removeUserFromLab');
    }
  }

  async function toggleOrgAdmin() {
    if (selectedUser.value === null) return;

    useUiStore().setRequestPending('toggleOrgAdmin');

    try {
      await $api.orgs.editOrgUser(
        props.orgId,
        props.userId,
        selectedUser.value.OrganizationUserStatus,
        !selectedUserOrgAdmin.value,
      );
      useToastStore().success(`${getSelectedUserDisplayName.value}’s Lab Access has been successfully updated`);
      await updateSelectedUser();
    } catch (error) {
      useToastStore().error(VALIDATION_MESSAGES.network);
      console.error(error);
    }

    useUiStore().setRequestComplete('toggleOrgAdmin');
  }
</script>

<template>
  <!-- org admin toggle -->
  <div class="mb-4">
    <!-- loading skeleton -->
    <div class="bg-skeleton-container flex h-[82px] items-center rounded p-4" v-if="isLoading">
      <div class="mr-2">
        <USkeleton class="h-[32px] w-[32px]" :ui="{ rounded: 'rounded-full' }" />
      </div>
      <div class="space-y-2">
        <USkeleton class="h-4 w-[250px] rounded" />
        <USkeleton class="h-3 w-[200px] rounded" />
      </div>
    </div>

    <!-- toggle -->
    <div
      v-else
      class="border-stroke-light flex min-h-[82px] items-center justify-between gap-3 rounded border border-solid bg-white p-4"
    >
      <div class="user-summary flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <EGUserDisplay
          :initials="getSelectedUserInitials"
          :name="getSelectedUserDisplayName"
          :email="selectedUser.UserEmail"
          :inactive="selectedUser.OrganizationUserStatus !== 'Active'"
        />
      </div>
      <div class="flex shrink-0 items-center whitespace-nowrap">
        <label :id="orgAdminToggleId" class="text-xs" :for="`${orgAdminToggleId}-input`">Organization Admin</label>
        <UToggle
          :id="`${orgAdminToggleId}-input`"
          class="ml-2"
          :model-value="!!selectedUserOrgAdmin"
          :disabled="useUiStore().anyRequestPending(['updateUser', 'toggleOrgAdmin'])"
          :aria-labelledby="orgAdminToggleId"
          :ui="{
            base: 'test-org-admin-toggle',
          }"
          @change="toggleOrgAdmin"
        />
      </div>
    </div>
  </div>

  <EGSearchInput
    v-if="!hasNoData"
    @input-event="updateSearchOutput"
    label="Search labs"
    placeholder="Search All Labs"
    class="my-6 w-[408px]"
  />

  <EGEmptyDataCTA
    v-if="hasNoData"
    message="There are no labs in your Organization"
    :primary-button-action="useUserStore().canCreateLab() ? () => $router.push({ path: '/labs/create' }) : null"
    :primary-button-label="useUserStore().canCreateLab() ? 'Create a Lab' : null"
  />

  <EGTable
    v-if="!hasNoData"
    :table-data="filteredTableData"
    :columns="tableColumns"
    :show-pagination="!isLoading"
    :is-loading="isLoading"
  >
    <template #actions-data="{ row }">
      <div class="flex items-center" v-if="row.labAccessOptionsEnabled">
        <EGUserRoleDropdown
          :key="row"
          :disabled="
            useUiStore().anyRequestPending([
              'updateUser',
              'fetchOrgLabs',
              'fetchUserLabs',
              'addUserToLab',
              'assignLabRole',
              'removeUserFromLab',
            ]) || useUserStore().isSuperuser
          "
          :user="row"
          @assign-role="handleAssignRole($event.labUser)"
          :show-remove-from-lab="true"
          @remove-user-from-lab="() => showRemoveUserDialog({ id: row.LaboratoryId, name: row.Name })"
        />
      </div>
      <EGButton
        :loading="useUiStore().isRequestPending(`addUserToLabButton-${props.userId}-${row.LaboratoryId}`)"
        v-else-if="row.access"
        @click="
          handleAddUser({
            labId: row.LaboratoryId,
            name: row.Name,
          })
        "
        label="Grant access"
        variant="secondary"
        size="sm"
        :disabled="useUserStore().isSuperuser"
      />
    </template>
  </EGTable>

  <EGDialog
    actionLabel="Remove User"
    :actionVariant="ButtonVariantEnum.enum.destructive"
    cancelLabel="Cancel"
    :cancelVariant="ButtonVariantEnum.enum.secondary"
    @action-triggered="handleRemoveUserFromLab"
    :primaryMessage="`Are you sure you want to remove ${getSelectedUserDisplayName} from ${labToRemoveFrom?.name}?`"
    v-model="isRemoveUserDialogOpen"
  />
</template>

<style scoped lang="scss">
  // EGUserDisplay's own text column has no width constraint or truncation,
  // which is fine at full page width but clips abruptly in this drawer's
  // narrower card. Pierce into it to constrain + ellipsis-truncate instead.
  .user-summary {
    :deep(.flex.grow) {
      min-width: 0;
      overflow: hidden;
    }

    :deep(.flex.grow > div) {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }
</style>
