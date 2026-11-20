<script setup lang="ts">
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { DeletedResponse } from '@FE/types/api';
  import {
    buildLabPickerRows,
    buildOrgPickerRows,
    labRowsState,
    orgsYouCanOpen,
    type LabPickerRow,
  } from '@FE/utils/org-lab-navigation';

  const { $api } = useNuxtApp();
  const orgsStore = useOrgsStore();
  const labsStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  const { goInOrg } = useOrgLabNavigation();

  const previewOrgId = ref<string>(userStore.currentOrgId ?? '');
  const loadingOrgIds = ref<Set<string>>(new Set());
  const failedOrgIds = ref<Set<string>>(new Set());

  const openableOrgs = computed(() =>
    orgsYouCanOpen(Object.values(orgsStore.orgs), userStore.currentUserPermissions.orgPermissions),
  );

  const isSwitching = computed<boolean>(() => uiStore.isRequestPending('switchOrg'));

  async function loadLabs(orgId: string): Promise<void> {
    loadingOrgIds.value = new Set(loadingOrgIds.value).add(orgId);
    try {
      const loaded = await labsStore.loadLabsForOrg(orgId);
      const failed = new Set(failedOrgIds.value);
      if (loaded) failed.delete(orgId);
      else failed.add(orgId);
      failedOrgIds.value = failed;
    } finally {
      const remaining = new Set(loadingOrgIds.value);
      remaining.delete(orgId);
      loadingOrgIds.value = remaining;
    }
  }

  onBeforeMount(async () => {
    await Promise.all(openableOrgs.value.map((org) => loadLabs(org.OrganizationId)));
  });

  const orgRows = computed(() =>
    buildOrgPickerRows(openableOrgs.value, {
      currentOrgId: userStore.currentOrgId,
      previewOrgId: previewOrgId.value,
      // A failed load keeps the persisted list, so its count would be stale
      labCountByOrg: Object.fromEntries(
        openableOrgs.value.map(({ OrganizationId: orgId }) => [
          orgId,
          failedOrgIds.value.has(orgId) ? undefined : labsStore.labIdsByOrg[orgId]?.length,
        ]),
      ),
      isOrgAdmin: (orgId) => userStore.isOrgAdminForOrg(orgId),
    }),
  );

  const previewOrg = computed(() => orgRows.value.find((row) => row.isPreviewed) ?? null);
  const previewOrgName = computed<string>(() => previewOrg.value?.name ?? '');

  const labRows = computed<LabPickerRow[]>(() =>
    buildLabPickerRows(labsStore.labsForOrg(previewOrgId.value), {
      orgId: previewOrgId.value,
      currentOrgId: userStore.currentOrgId,
      currentLabId: userStore.mostRecentLabId,
      canOpenSettings: userStore.canEditLabDetailsForOrg(previewOrgId.value),
    }),
  );

  const labsState = computed(() =>
    labRowsState({
      isLoading: loadingOrgIds.value.has(previewOrgId.value),
      hasFailed: failedOrgIds.value.has(previewOrgId.value),
      labCount: labRows.value.length,
    }),
  );

  const previewLabCount = computed<string>(() => {
    const count = labsStore.labIdsByOrg[previewOrgId.value]?.length;
    if (count === undefined || failedOrgIds.value.has(previewOrgId.value)) return '';
    return count === 1 ? '1 lab' : `${count} labs`;
  });

  const canManagePreviewOrg = computed<boolean>(() => userStore.isOrgAdminForOrg(previewOrgId.value));
  const canCreateLab = computed<boolean>(() => userStore.canCreateLabForOrg(previewOrgId.value));
  const canRemoveLab = computed<boolean>(() => userStore.canDeleteLabForOrg(previewOrgId.value));

  function selectLab(lab: LabPickerRow): void {
    if (isSwitching.value) return;
    goInOrg(previewOrgId.value, `/labs/${lab.labId}`, { labName: lab.name, orgName: previewOrgName.value });
  }

  function openLabSettings(lab: LabPickerRow): void {
    goInOrg(previewOrgId.value, `/labs/${lab.labId}?tab=Settings`);
  }

  function openOrgSettings(orgId: string): void {
    goInOrg(orgId, `/orgs/${orgId}`);
  }

  function createLab(): void {
    goInOrg(previewOrgId.value, '/labs/create');
  }

  const labToRemove = ref<LabPickerRow | null>(null);
  const isRemoveLabDialogOpen = ref<boolean>(false);

  function moreActions(lab: LabPickerRow) {
    return [
      [
        {
          label: 'Remove',
          class: 'text-alert-danger-dark',
          click: () => {
            labToRemove.value = lab;
            isRemoveLabDialogOpen.value = true;
          },
        },
      ],
    ];
  }

  async function removeLab(): Promise<void> {
    const lab = labToRemove.value;
    isRemoveLabDialogOpen.value = false;
    if (!lab) return;

    uiStore.setRequestPending('deleteLab');
    try {
      const res: DeletedResponse = await $api.labs.delete(lab.labId);
      if (res?.Status !== 'Success') {
        throw new Error(`Lab ${lab.labId} not removed; status ${res?.Status}`);
      }
      useToastStore().success(`Lab '${lab.name}' has been removed`);
      await loadLabs(previewOrgId.value);
    } catch (error) {
      console.error(error);
      useToastStore().error(`Failed to remove lab '${lab.name}'`);
    } finally {
      uiStore.setRequestComplete('deleteLab');
      labToRemove.value = null;
    }
  }
</script>

<template>
  <EGPageHeader
    title="Organizations and labs"
    description="Pick an organization, then the lab you want to work in."
    :show-back="false"
  />

  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <nav aria-label="Organizations" class="w-full shrink-0 lg:w-80">
      <h2 class="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Organizations</h2>
      <ul class="flex list-none flex-col gap-1 p-0">
        <li v-for="org in orgRows" :key="org.orgId" class="flex items-center gap-1">
          <button
            type="button"
            class="focus-visible:outline-primary-500 flex min-h-[52px] min-w-0 grow flex-col items-start justify-center rounded-lg px-3 py-2 text-left focus-visible:outline focus-visible:outline-2"
            :class="org.isPreviewed ? 'bg-primary-muted text-primary-dark' : 'hover:bg-background-light-grey'"
            :aria-current="org.isPreviewed ? 'true' : undefined"
            @click="previewOrgId = org.orgId"
          >
            <span class="w-full truncate font-semibold">{{ org.name }}</span>
            <span v-if="org.detail" class="text-muted text-xs">{{ org.detail }}</span>
          </button>
          <UButton
            v-if="org.canManage"
            icon="i-heroicons-cog-6-tooth"
            color="gray"
            variant="ghost"
            :aria-label="`Settings for ${org.name}`"
            :disabled="isSwitching"
            @click="openOrgSettings(org.orgId)"
          />
        </li>
      </ul>
    </nav>

    <section
      aria-labelledby="previewed-org-heading"
      class="min-w-0 grow overflow-x-auto rounded-xl border border-gray-200 bg-white"
    >
      <div class="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 id="previewed-org-heading" class="text-xl font-bold">{{ previewOrgName }}</h2>
          <p v-if="previewLabCount" class="text-muted mt-1 text-sm">{{ previewLabCount }}</p>
        </div>
        <div v-if="canManagePreviewOrg" class="flex flex-wrap gap-2">
          <EGButton
            label="Organization settings"
            :variant="ButtonVariantEnum.enum.secondary"
            :disabled="isSwitching"
            @click="openOrgSettings(previewOrgId)"
          />
          <EGButton v-if="canCreateLab" label="Create a new lab" :disabled="isSwitching" @click="createLab" />
        </div>
      </div>

      <div v-if="labsState === 'loading'" class="flex flex-col gap-2 px-5 pb-5">
        <USkeleton v-for="line in 3" :key="line" class="h-12 w-full rounded" />
      </div>

      <div v-else-if="labsState === 'failed'" role="alert" class="flex items-center gap-4 px-5 pb-5">
        <span>Couldn't load labs for this organization.</span>
        <EGButton
          label="Try again"
          :variant="ButtonVariantEnum.enum.secondary"
          :size="ButtonSizeEnum.enum.sm"
          @click="loadLabs(previewOrgId)"
        />
      </div>

      <p v-else-if="labsState === 'empty'" class="text-muted px-5 pb-5">
        {{
          canCreateLab ? "This organization doesn't have any labs yet." : "You don't have access to any labs here yet."
        }}
      </p>

      <table v-else class="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr class="border-t border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <th scope="col" class="px-5 py-3 font-semibold">Lab</th>
            <th scope="col" class="px-5 py-3 text-right"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="lab in labRows"
            :key="lab.labId"
            class="hover:bg-background-light-grey cursor-pointer border-t border-gray-200"
            :class="{ 'bg-primary-muted/40': lab.isCurrent }"
            @click="selectLab(lab)"
          >
            <td class="px-5 py-4">
              <span class="font-semibold" :class="{ 'text-primary-dark': lab.isCurrent }">{{ lab.name }}</span>
              <span v-if="lab.description" class="text-muted mt-1 block max-w-md text-sm">{{ lab.description }}</span>
            </td>
            <td class="whitespace-nowrap px-5 py-4 text-right" @click.stop>
              <div class="inline-flex items-center gap-2">
                <EGButton
                  v-if="lab.showSettings"
                  label="Settings"
                  :variant="ButtonVariantEnum.enum.secondary"
                  :size="ButtonSizeEnum.enum.sm"
                  :aria-label="`Settings for ${lab.name}`"
                  :disabled="isSwitching"
                  @click="openLabSettings(lab)"
                />
                <EGButton
                  :label="lab.actionLabel"
                  :variant="lab.isCurrent ? ButtonVariantEnum.enum.primary : ButtonVariantEnum.enum.secondary"
                  :size="ButtonSizeEnum.enum.sm"
                  :aria-label="`${lab.isCurrent ? 'Open' : 'Select'} ${lab.name}`"
                  :disabled="isSwitching"
                  @click="selectLab(lab)"
                />
                <UDropdown v-if="canRemoveLab" :items="moreActions(lab)" :popper="{ placement: 'bottom-end' }">
                  <UButton
                    icon="i-heroicons-ellipsis-horizontal"
                    color="gray"
                    variant="ghost"
                    :aria-label="`More actions for ${lab.name}`"
                    :disabled="isSwitching"
                  />
                </UDropdown>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>

  <EGDialog
    action-label="Remove Lab"
    :action-variant="ButtonVariantEnum.enum.destructive"
    cancel-label="Cancel"
    :cancel-variant="ButtonVariantEnum.enum.secondary"
    :primary-message="`Are you sure you want to remove lab '${labToRemove?.name ?? ''}'?`"
    v-model="isRemoveLabDialogOpen"
    @action-triggered="removeLab"
  />
</template>
