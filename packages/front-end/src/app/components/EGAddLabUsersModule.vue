<script setup lang="ts">
  import { LabUser, OrgUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-unified';
  import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
  import { UserStatusSchema } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/status';
  import { LaboratoryRolesEnumSchema } from '@FE/types/roles';
  import { LaboratoryUserBulkResult } from '@FE/types/api';

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
  const roleSelectId = useId();
  const addUsersStatusId = 'add-lab-users-status';

  const roleOptions = [LaboratoryRolesEnumSchema.enum.LabTechnician, LaboratoryRolesEnumSchema.enum.LabManager];
  const selectedRole = ref<string>(LaboratoryRolesEnumSchema.enum.LabTechnician);
  const bulkResult = ref<LaboratoryUserBulkResult[] | null>(null);
  const selectedUsersSnapshot = ref<Map<string, string>>(new Map());

  const bulkResultSummary = computed(() => {
    if (!bulkResult.value) return null;
    return {
      added: bulkResult.value.filter((r) => r.Outcome === 'Added').length,
      skipped: bulkResult.value.filter((r) => r.Outcome === 'Skipped').length,
      failed: bulkResult.value.filter((r) => r.Outcome === 'Failed').length,
    };
  });

  const bulkResultDetails = computed(() =>
    (bulkResult.value || [])
      .filter((r) => r.Outcome !== 'Added')
      .map((r) => ({
        ...r,
        displayName: selectedUsersSnapshot.value.get(r.UserId) || r.UserId,
      })),
  );

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
    bulkResult.value = null;
    selectedUsersSnapshot.value = new Map(
      inviteSelectedUserIds.value.map((userId) => {
        const user = otherOrgUsers.value.find((u) => u.UserId === userId);
        return [userId, user?.displayName || userId];
      }),
    );

    try {
      const isLabManager = selectedRole.value === LaboratoryRolesEnumSchema.enum.LabManager;
      const results = await $api.labs.addBulkLabUsers(props.labId, inviteSelectedUserIds.value, isLabManager);
      bulkResult.value = results;

      const addedCount = results.filter((r) => r.Outcome === 'Added').length;
      if (addedCount > 0) {
        emit('added-user-to-lab');
      }
      inviteSelectedUserIds.value = [];
      await getOrgUsersWithoutLabAccess();
    } catch (e) {
      toastStore.error('An error occurred while adding users to the lab. No users were added.');
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
        <div>
          <label :for="roleSelectId" class="sr-only">Role for added users</label>
          <USelectMenu
            :id="roleSelectId"
            v-model="selectedRole"
            :options="roleOptions"
            class="w-44"
            size="xl"
            :disabled="uiStore.anyRequestPending(['getLabUsers', 'addUsersToLab'])"
            aria-label="Role for added users"
          />
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

      <div v-if="bulkResultSummary" class="border-stroke-light mt-4 rounded border border-solid p-3" role="status">
        <p class="text-sm font-medium">
          Added {{ bulkResultSummary.added }}, Skipped {{ bulkResultSummary.skipped }}, Failed
          {{ bulkResultSummary.failed }}
        </p>
        <ul v-if="bulkResultDetails.length" class="mt-2 space-y-1 text-sm">
          <li v-for="item in bulkResultDetails" :key="item.UserId" class="text-alert-caution">
            {{ item.displayName }} — {{ item.Outcome }}{{ item.Reason ? `: ${item.Reason}` : '' }}
          </li>
        </ul>
      </div>
    </EGCard>
  </div>
</template>
