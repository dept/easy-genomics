<script setup lang="ts">
  import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
  import { OrgUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-unified';
  import { UserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user';
  import useUser from '@FE/composables/useUser';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { DeletedResponse } from '@FE/types/api';
  import type { FormSubmitEvent } from '#ui/types';
  import { OrgDetailsForm } from '@FE/types/forms';
  import { VALIDATION_MESSAGES } from '@FE/constants/validation';

  const props = defineProps<{
    orgId: string;
    superuser?: boolean;
    orgAdmin?: boolean;
  }>();

  const { $api } = useNuxtApp();
  const router = useRouter();
  const route = useRoute();
  const { resendInvite, labsCount } = useUser();

  const disabledButtons = ref<Record<number, boolean>>({});
  const buttonRequestPending = ref<Record<number, boolean>>({});
  const orgUsersDetailsData = ref<OrgUser[]>([]);
  const showInviteModule = ref(false);
  const openUserId = computed<string | null>(() => (route.query.openUser as string) || null);

  const resetFormKey = ref(0);

  const hasNoData = computed<boolean>(() => orgUsersDetailsData.value.length === 0);
  const isLoading = computed<boolean>(() => useUiStore().anyRequestPending(['fetchOrgData', 'editOrg']));

  // Dynamic remove user dialog values
  const isRemoveUserModalOpen = ref(false);
  const removeUserModalPrimaryMessage = ref('');
  const removeUserModalActionLabel = ref('Remove User');
  const userToRemoveId = ref('');
  const isRemovingUser = ref(false);

  // Table-related refs and computed props
  const searchOutput = ref('');

  const showWorkflowAccessTab = computed(() => props.superuser || props.orgAdmin);

  const tabItems = computed<{ key: string; label: string; icon: string }[]>(() => {
    const items: { key: string; label: string; icon: string }[] = [];
    if (props.superuser) {
      items.push({ key: 'labs', label: 'All Labs', icon: 'i-heroicons-beaker' });
    }
    items.push({ key: 'users', label: 'All users', icon: 'i-heroicons-users' });
    if (showWorkflowAccessTab.value) {
      items.push({ key: 'workflow-access', label: 'Workflow access', icon: 'i-heroicons-key' });
    }
    items.push({ key: 'details', label: 'Settings', icon: 'i-heroicons-cog-6-tooth' });
    return items;
  });

  /** Mount workflow access panel once opened (or via ?tab=) so data loads lazily; stay mounted to keep unsaved edits. */
  const workflowAccessPanelMounted = ref(false);
  const tabIndex = ref(0);

  function syncWorkflowAccessTabFromQuery() {
    if (String(route.query.tab) !== 'workflow-access' || !showWorkflowAccessTab.value) {
      return;
    }
    const idx = tabItems.value.findIndex((t) => t.key === 'workflow-access');
    if (idx >= 0) {
      tabIndex.value = idx;
      workflowAccessPanelMounted.value = true;
    }
  }

  const activeTabKey = computed(() => tabItems.value[tabIndex.value]?.key || '');

  function handleTabChange(newIndex: number) {
    tabIndex.value = newIndex;
  }

  watch(tabItems, (items) => {
    if (tabIndex.value >= items.length) {
      tabIndex.value = Math.max(0, items.length - 1);
    }
  });

  watch(tabIndex, (idx) => {
    const item = tabItems.value[idx];
    if (item?.key === 'workflow-access') {
      workflowAccessPanelMounted.value = true;
    }
  });

  watch(
    () => route.query.tab,
    () => syncWorkflowAccessTabFromQuery(),
  );

  onBeforeMount(() => {
    syncWorkflowAccessTabFromQuery();
  });

  const tableColumns = [
    {
      key: 'displayName',
      label: 'Name',
      sortable: true,
      sort: useSort().stringSortCompare,
    },
    {
      key: 'status',
      label: 'Status',
    },
    {
      key: 'labs',
      label: 'Labs',
    },
    {
      key: 'actions',
      label: 'Actions',
    },
  ];

  function editUser(userId: string) {
    router.push({ query: { ...route.query, openUser: userId } });
  }

  function closeUserAccessDrawer() {
    const { openUser: _openUser, ...remainingQuery } = route.query;
    router.push({ query: remainingQuery });
  }

  function onRowClicked(row: OrgUser) {
    editUser(row.UserId);
  }

  function actionItems(user: OrgUser) {
    const items: object[] = [
      [
        {
          label: 'Edit User Access',
          click: async () => editUser(user.UserId),
        },
      ],
    ];

    if (props.superuser || props.orgAdmin) {
      const invited = isInvited(user.OrganizationUserStatus);
      items.push([
        {
          label: invited ? 'Revoke invite' : 'Remove From Org',
          class: 'text-alert-danger-dark',
          isHighlighted: true,
          click: () => {
            userToRemoveId.value = user.UserId;
            removeUserModalPrimaryMessage.value = invited
              ? `Are you sure you want to revoke the invitation for ${user.UserEmail}?`
              : `Are you sure you want to remove ${user.displayName} from ${org.value.Name}?`;
            removeUserModalActionLabel.value = invited ? 'Revoke Invite' : 'Remove User';
            isRemoveUserModalOpen.value = true;
          },
        },
      ]);
    }

    return items;
  }

  /**
   * Filter rows based on search input for both name and email
   */
  const filteredTableData = computed(() => {
    let data = orgUsersDetailsData.value;

    if (searchOutput.value) {
      data = data.filter((user: OrgUser) => {
        const fullName = user.displayName.toLowerCase();
        const email = String(user.UserEmail).toLowerCase();

        return fullName.includes(lowerCasedSearch.value) || email.includes(lowerCasedSearch.value);
      });
    }

    return data.sort((userA, userB) => useSort().stringSortCompare(userA.displayName, userB.displayName));
  });

  const lowerCasedSearch = computed(() => searchOutput.value.toLowerCase());

  const usersSearchStatusMessage = computed(() => {
    const q = searchOutput.value.trim();
    if (!q || hasNoData.value) return '';
    const count = filteredTableData.value.length;
    if (count === 0) return `No users match "${q}"`;
    const noun = count === 1 ? 'user' : 'users';
    return `${count} ${noun} match "${q}"`;
  });

  watch(showInviteModule, (isOpen) => {
    if (!isOpen) return;
    nextTick(() => {
      const panel = document.getElementById(invitePanelId);
      const focusable = panel?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
  });

  onBeforeMount(async () => {
    await fetchOrgData();
  });

  onMounted(() => {
    useUiStore().setSidebarVisible(true);
  });

  onBeforeUnmount(() => {
    useUiStore().setSidebarVisible(false);
  });

  async function handleRemoveOrgUser() {
    isRemoveUserModalOpen.value = false;
    isRemovingUser.value = true;

    const userToRemove = orgUsersDetailsData.value.find((user) => user.UserId === userToRemoveId.value);
    const displayName = userToRemove?.displayName;
    const wasInvited = userToRemove ? isInvited(userToRemove.OrganizationUserStatus) : false;

    try {
      if (!userToRemoveId.value) {
        throw new Error('No userToRemoveId');
      }

      const res: DeletedResponse = await $api.orgs.removeUser(props.orgId, userToRemoveId.value);

      if (res?.Status === 'Success') {
        useToastStore().success(
          wasInvited
            ? `Invitation for ${userToRemove?.UserEmail} has been revoked`
            : `${displayName} has been removed from ${org.value.Name}`,
        );
        await fetchOrgData(false);
      } else {
        throw new Error('User not removed from Organization');
      }
    } catch (error) {
      useToastStore().error(
        wasInvited
          ? `Failed to revoke the invitation for ${userToRemove?.UserEmail}`
          : `Failed to remove ${displayName} from  ${org.value.Name}`,
      );
      throw error;
    } finally {
      userToRemoveId.value = '';
      isRemoveUserModalOpen.value = false;
      isRemovingUser.value = false;
    }
  }

  function isInvited(status: string) {
    return status === UserSchema.shape.Status.enum.Invited;
  }

  /**
   * Fetches Organization data - org users and (optionally) org settings
   * @param shouldGetOrgSettings
   */
  async function fetchOrgData(shouldGetOrgSettings: boolean = true) {
    useUiStore().setRequestPending('fetchOrgData');
    try {
      if (shouldGetOrgSettings) {
        await useOrgsStore().loadOrg(props.orgId);
      }

      const orgUsers: OrganizationUserDetails[] = await $api.orgs.usersDetailsByOrgId(props.orgId);

      // Add displayName to each of the user records for display and sorting purposes
      orgUsersDetailsData.value = orgUsers.map((user) => ({
        ...user,
        displayName: useUser().displayName({
          preferredName: user.PreferredName,
          firstName: user.FirstName,
          lastName: user.LastName,
          email: user.UserEmail,
        }),
      }));
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      useUiStore().setRequestComplete('fetchOrgData');
      // force remount of form to get fresh org values
      resetFormKey.value++;
    }
  }

  // must be declared after store is set in fetchOrgData()
  const org = computed(() => useOrgsStore().orgs[props.orgId] || {});

  const invitePanelId = 'org-invite-users-panel';
  const usersHeadingId = 'org-users-heading';
  const workflowAccessHeadingId = 'org-workflow-access-heading';

  usePageTitle(() => (org.value.Name ? `${org.value.Name}` : 'Organization'));

  async function resend(userDetails: OrgUser, index: number) {
    const { OrganizationId, UserEmail } = userDetails;

    if (!UserEmail) {
      console.error('UserEmail is missing');
      return;
    }

    setButtonRequestPending(true, index);

    try {
      await resendInvite({ OrganizationId, UserEmail });
      disableButton(index);
    } catch (error) {
      console.error(error);
    } finally {
      setButtonRequestPending(false, index);
    }
  }

  function disableButton(index: number) {
    disabledButtons.value[index] = true;
    buttonRequestPending.value[index] = false;
  }

  function setButtonRequestPending(isPending: boolean, index: number) {
    buttonRequestPending.value[index] = isPending;
  }

  async function refreshUserList() {
    try {
      const orgUsers: OrganizationUserDetails[] = await $api.orgs.usersDetailsByOrgId(props.orgId);

      // Add displayName to each of the user records for display and sorting purposes
      orgUsersDetailsData.value = orgUsers.map((user) => ({
        ...user,
        displayName: useUser().displayName({
          preferredName: user.PreferredName,
          firstName: user.FirstName,
          lastName: user.LastName,
          email: user.UserEmail,
        }),
      }));
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      showInviteModule.value = false;
    }
  }

  function isButtonRequestPending(index: number) {
    return buttonRequestPending.value[index];
  }

  function isButtonDisabled(index: number) {
    return disabledButtons.value[index];
  }

  function updateSearchOutput(newVal: string) {
    searchOutput.value = newVal;
  }

  async function onSubmit(event: FormSubmitEvent<OrgDetailsForm>) {
    try {
      useUiStore().setRequestPending('editOrg');
      const { Name, Description, NextFlowTowerApiBaseUrl } = event.data;
      await $api.orgs.update(props.orgId, { Name, Description, NextFlowTowerApiBaseUrl });
      await fetchOrgData();
      useToastStore().success('Organization updated');
    } catch (error) {
      useToastStore().error(VALIDATION_MESSAGES.network);
    } finally {
      useUiStore().setRequestComplete('editOrg');
    }
  }
</script>

<template>
  <EGSidebarNav
    aria-label="Organization sections"
    variant="dark"
    callout-title="Admin view"
    callout-description="You're managing organization-level settings, not a single lab."
    :items="tabItems"
    :model-value="tabIndex"
    @update:model-value="handleTabChange"
  />

  <EGPageHeader
    :title="org.Name"
    :description="org.Description"
    :back-action="() => $router.push('/orgs')"
    :show-back="true"
    :is-loading="isLoading"
    :skeleton-config="{ titleLines: 1, descriptionLines: 1 }"
    show-org-breadcrumb
  >
    <EGButton
      v-if="activeTabKey === 'users'"
      u-button-type="button"
      label="Invite users"
      :aria-expanded="showInviteModule"
      :aria-controls="invitePanelId"
      @click="() => (showInviteModule = !showInviteModule)"
    />
    <div
      :id="invitePanelId"
      class="mt-2 w-[500px]"
      v-if="showInviteModule && activeTabKey === 'users'"
      role="region"
      aria-label="Invite users by email"
    >
      <EGInviteModule @invite-success="refreshUserList($event)" :org-id="props.orgId" />
    </div>
  </EGPageHeader>

  <!-- Settings tab -->
  <div v-if="activeTabKey === 'details'" role="tabpanel" id="panel-details" aria-labelledby="tab-details" tabindex="0">
    <h2 class="sr-only">Organization settings</h2>
    <EGFormOrgDetails
      :key="resetFormKey"
      @submit-form-org-details="onSubmit($event)"
      :name="org.Name"
      :description="org.Description"
      :seqera-base-url="org.NextFlowTowerApiBaseUrl"
    />
  </div>

  <!-- All Labs tab (superuser) -->
  <div
    v-if="activeTabKey === 'labs' && props.superuser"
    role="tabpanel"
    id="panel-labs"
    aria-labelledby="tab-labs"
    tabindex="0"
  >
    <h2 class="sr-only">All labs</h2>
    <EGLabsList superuser :org-id="props.orgId" />
  </div>

  <div
    v-if="activeTabKey === 'workflow-access' && showWorkflowAccessTab"
    role="tabpanel"
    id="panel-workflow-access"
    aria-labelledby="tab-workflow-access"
    tabindex="0"
    class="outline-none focus:outline-none"
  >
    <EGWorkflowLabAccessPage
      v-if="workflowAccessPanelMounted"
      :org-id="props.orgId"
      embedded
      :heading-id="workflowAccessHeadingId"
    />
  </div>

  <!-- All users tab -->
  <div
    v-if="activeTabKey === 'users'"
    role="tabpanel"
    id="panel-users"
    aria-labelledby="tab-users"
    tabindex="0"
    class="outline-none focus:outline-none"
    :aria-busy="isLoading || isRemovingUser"
  >
    <section :aria-labelledby="usersHeadingId">
      <EGText :id="usersHeadingId" tag="h2" class="sr-only">Organization users</EGText>

      <EGEmptyDataCTA
        v-if="!isLoading && hasNoData"
        message="You don't have any users in this organization yet."
        img-src="/images/empty-state-user.jpg"
      />

      <template v-if="!hasNoData">
        <EGSearchInput
          @input-event="updateSearchOutput"
          label="Search users"
          placeholder="Search user"
          class="my-6 w-[408px]"
          :disabled="isLoading"
        />
        <p class="sr-only" aria-live="polite" aria-atomic="true">{{ usersSearchStatusMessage }}</p>

        <EGDialog
          :action-label="removeUserModalActionLabel"
          :action-variant="ButtonVariantEnum.enum.destructive"
          cancel-label="Cancel"
          :cancel-variant="ButtonVariantEnum.enum.secondary"
          @action-triggered="handleRemoveOrgUser"
          :primary-message="removeUserModalPrimaryMessage"
          v-model="isRemoveUserModalOpen"
        />

        <EGUserAccessDrawer
          :model-value="!!openUserId"
          :org-id="props.orgId"
          :user-id="openUserId || ''"
          @update:model-value="
            (open) => {
              if (!open) closeUserAccessDrawer();
            }
          "
        />

        <EGTable
          :table-data="filteredTableData"
          :columns="tableColumns"
          :is-loading="isLoading"
          :action-items="actionItems"
          :show-pagination="!isLoading"
          :row-click-action="onRowClicked"
          :labelled-by="usersHeadingId"
        >
          <template #displayName-data="{ row }">
            <div class="flex items-center">
              <EGUserDisplay
                class="mr-4"
                :name="row.displayName"
                :email="row.UserEmail"
                :inactive="row.OrganizationUserStatus !== 'Active'"
              />
            </div>
          </template>
          <template #status-data="{ row }">
            <EGUserStatusChip :status="(row as OrgUser).OrganizationUserStatus" />
          </template>
          <template #labs-data="{ row }">
            <span class="text-muted">
              <span class="sr-only">Labs:</span>
              {{ labsCount(row) }}
            </span>
          </template>
          <template #actions-data="{ row, index }">
            <div class="flex items-center justify-end">
              <EGButton
                class="relative z-10"
                u-button-type="button"
                size="sm"
                variant="secondary"
                label="Resend Invite"
                v-if="isInvited((row as OrgUser).OrganizationUserStatus) && (props.superuser || props.orgAdmin)"
                :aria-label="`Resend invite to ${(row as OrgUser).displayName}`"
                @click="
                  $event.stopPropagation();
                  resend(row as OrgUser, index);
                "
                :disabled="isButtonDisabled(index) || isButtonRequestPending(index)"
                :loading="isButtonRequestPending(index)"
              />
              <EGActionButton
                :menu-label="`Actions for ${(row as OrgUser).displayName}`"
                @click="$event.stopPropagation()"
                :items="actionItems(row)"
                class="ml-2"
              />
            </div>
          </template>
        </EGTable>

        <div class="text-muted my-6 text-center text-xs" role="note">
          This organization can only be removed by contacting your System administrator at: [System admin email]
        </div>
      </template>
    </section>
  </div>
</template>
