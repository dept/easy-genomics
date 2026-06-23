<script setup lang="ts">
  import { LabUser, OrgUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-unified';
  import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
  import { UserStatusSchema } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/status';

  const props = defineProps<{
    orgId: string;
    labId: string;
    labName: string;
    labUsers: LabUser[];
  }>();

  const emit = defineEmits(['added-user-to-lab']);

  const { $api } = useNuxtApp();

  const uiStore = useUiStore();
  const toastStore = useToastStore();

  const otherOrgUsers = ref<OrgUser[]>([]);
  const inviteSelectedUserIds = ref<string[]>([]);
  const selectId = useId();
  const addUsersStatusId = 'add-lab-users-status';

  const addUsersStatusMessage = computed(() => {
    if (uiStore.isRequestPending('getLabUsers')) return 'Loading organization users…';
    if (uiStore.isRequestPending('addUsersToLab')) return 'Adding users to lab…';
    if (props.labUsers.length === 0 && otherOrgUsers.value.length === 0) {
      return 'The organization has no users available to add.';
    }
    if (props.labUsers.length > 0 && otherOrgUsers.value.length === 0) {
      return 'All organization users already have access to this lab.';
    }
    return '';
  });

  // refresh org users without lab access if labUsers changes
  watch(
    () => props.labUsers,
    async (_newLabUsers) => await getOrgUsersWithoutLabAccess(),
  );

  onMounted(async () => await getOrgUsersWithoutLabAccess());

  async function handleAddSelectedUserToLab() {
    uiStore.setRequestPending('addUsersToLab');

    try {
      await Promise.all(inviteSelectedUserIds.value!.map((userId) => $api.labs.addLabUser(props.labId, userId)));

      const users = `${inviteSelectedUserIds.value.length} user${inviteSelectedUserIds.value.length === 1 ? '' : 's'}`;
      useToastStore().success(`Successfully added ${users} to ${props.labName}`);

      inviteSelectedUserIds.value = [];
      emit('added-user-to-lab');
      await getOrgUsersWithoutLabAccess();
    } catch (e) {
      toastStore.error('An error occurred while adding users to the lab. Some users may not have been added.');
      throw e;
    } finally {
      uiStore.setRequestComplete('addUsersToLab');
    }
  }

  function hasLabAccessAlready(user: OrganizationUserDetails) {
    return props.labUsers.some((labUser: LabUser) => labUser.UserId === user.UserId);
  }

  async function getOrgUsersWithoutLabAccess() {
    uiStore.setRequestPending('getLabUsers');

    try {
      const orgUsers = (await $api.orgs.usersDetailsByOrgId(props.orgId)) as OrganizationUserDetails[];
      const _otherOrgUsers = orgUsers.filter((user: OrganizationUserDetails) => !hasLabAccessAlready(user));
      otherOrgUsers.value = _otherOrgUsers.map((user: OrganizationUserDetails) => {
        const nameData = {
          preferredName: user.PreferredName || null,
          firstName: user.FirstName || null,
          lastName: user.LastName || null,
          email: user.UserEmail || null,
        };
        const displayName = useUser().displayName(nameData);
        const initials = useUser().initials(nameData);

        return {
          ...user,
          displayName,
          initials,
        };
      });
    } finally {
      uiStore.setRequestComplete('getLabUsers');
    }
  }
</script>

<template>
  <div :aria-busy="uiStore.anyRequestPending(['getLabUsers', 'addUsersToLab'])">
    <EGCard :padding="4">
      <p :id="addUsersStatusId" class="sr-only" aria-live="polite" aria-atomic="true">{{ addUsersStatusMessage }}</p>
      <div class="flex space-x-4">
        <div class="grow">
          <label :for="selectId" class="sr-only">Select users to add to {{ labName }}</label>
          <USelectMenu
            :id="selectId"
            multiple
            v-model="inviteSelectedUserIds"
            :options="otherOrgUsers"
            option-attribute="displayName"
            value-attribute="UserId"
            :disabled="uiStore.anyRequestPending(['getLabUsers', 'addUsersToLab'])"
            :loading="uiStore.isRequestPending('getLabUsers')"
            placeholder="Select User"
            searchable
            searchable-placeholder="Search all users..."
            :search-attributes="['displayName', 'UserEmail']"
            clear-search-on-close
            class="w-full"
            size="xl"
            :ui="{
              base: 'h-[52px] min-w-96',
            }"
            :aria-label="`Select users to add to ${labName}`"
          >
            <template #option="{ option: user }">
              <EGUserDisplay
                :initials="user.initials"
                :name="user.displayName"
                :email="user.UserEmail"
                :inactive="user.OrganizationUserStatus !== UserStatusSchema.enum.Active"
              />
            </template>

            <template #option-empty="{ query }">
              <span>{{ query }}</span>
              not found
            </template>

            <template #empty>
              <div v-if="props.labUsers.length === 0 && otherOrgUsers.length === 0" role="status">
                The organization has no users
              </div>
              <div v-if="props.labUsers.length > 0 && otherOrgUsers.length === 0" role="status">
                All organization users already have access to this lab
              </div>
            </template>
          </USelectMenu>
        </div>
        <EGButton
          u-button-type="button"
          label="Add"
          :disabled="inviteSelectedUserIds.length < 1 || uiStore.anyRequestPending(['getLabUsers', 'addUsersToLab'])"
          :loading="uiStore.isRequestPending('addUsersToLab')"
          icon="i-heroicons-plus"
          :aria-describedby="addUsersStatusId"
          @click="handleAddSelectedUserToLab"
        />
      </div>
    </EGCard>
  </div>
</template>
