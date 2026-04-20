<script setup lang="ts">
  import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';

  const props = withDefaults(
    defineProps<{
      isAuthed?: boolean;
    }>(),
    {
      isAuthed: false,
    },
  );

  const userStore = useUserStore();
  const orgsStore = useOrgsStore();

  const { signOutAndRedirect } = useAuth();
  const $router = useRouter();
  const labsPath = '/labs';
  const orgsPath = '/orgs';

  function isSubpath(url: string) {
    return $router.currentRoute.value.path.includes(url);
  }

  const acctDropdownIsOpen = ref<boolean>(false);

  const switchToOrgId = ref<string | null>(null);
  const switchOrgDialogOpen = ref<boolean>(false);

  function selectSwitchToOrg(orgId: string): void {
    switchToOrgId.value = orgId;
    switchOrgDialogOpen.value = true;
  }

  const dropdownItems = computed<object[][]>(() => {
    const items = [];

    items.push([
      {
        slot: 'profile',
        class: 'bg-background-light-grey p-4',
        click: userStore.isSuperuser ? undefined : () => $router.push('/profile'),
      },
    ]);

    if (!userStore.isSuperuser && otherOrgs.value.length > 0) {
      items.push([
        {
          slot: 'other-orgs',
          class: 'bg-background-light-grey px-4',
        },
      ]);
    }

    items.push([
      {
        label: 'Sign Out',
        class: 'p-4 text-primary underline',
        click: signOutAndRedirect,
      },
    ]);

    return items;
  });

  const otherOrgs = computed<Organization[]>(() =>
    Object.values(orgsStore.orgs)
      .filter((org) => org.OrganizationId !== userStore.currentOrgId)
      .sort((a, b) => useSort().stringSortCompare(a.Name, b.Name)),
  );
</script>

<template>
  <header class="flex flex-row items-center px-8">
    <div class="header-container" :class="{ 'flex w-full flex-row items-center justify-between': props.isAuthed }">
      <template v-if="props.isAuthed">
        <img class="mr-2 w-[140px]" src="@/assets/images/easy-genomics-logo.svg" alt="EasyGenomics logo" />

        <div class="flex items-center gap-4">
          <ULink
            v-if="!userStore.isSuperuser"
            :to="labsPath"
            inactive-class="text-body"
            active-class="text-primary-dark bg-primary-muted"
            :class="isSubpath(labsPath) ? 'text-primary-dark bg-primary-muted' : ''"
            class="ULink text-body flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl px-4 py-1 font-serif text-sm tracking-normal"
          >
            Labs
          </ULink>
          <ULink
            v-if="userStore.canManageAnyOrgs()"
            :to="orgsPath"
            inactive-class="text-body"
            active-class="text-primary-dark bg-primary-muted"
            :class="isSubpath(orgsPath) ? 'text-primary-dark bg-primary-muted' : ''"
            class="ULink text-body flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl px-4 py-1 font-serif text-sm tracking-normal"
          >
            Organizations
          </ULink>

          <UDropdown
            v-model:open="acctDropdownIsOpen"
            :items="dropdownItems"
            :ui="{
              padding: '',
              width: 'w-80',
              item: {
                base: 'flex flex-col items-start gap-0',
                rounded: '',
              },
            }"
          >
            <EGUserDisplay :initials="userStore.currentUserInitials" />

            <template #profile>
              <div class="flex w-full flex-row items-center gap-3">
                <EGUserDisplay
                  class="grow"
                  :initials="userStore.currentUserInitials"
                  :name="userStore.currentUserDisplayName"
                  :organization="orgsStore.orgs[userStore.currentOrgId]?.Name ?? null"
                />

                <UIcon v-if="!userStore.isSuperuser" name="i-heroicons-chevron-right" class="h-6 w-6" />
              </div>
            </template>

            <template #other-orgs>
              <div class="text-muted pt-2">Other Organizations</div>

              <div class="flex w-full flex-col items-start" v-for="(org, i) of otherOrgs">
                <div v-if="i > 0" class="w-full border-t" />

                <div
                  @click="() => selectSwitchToOrg(org.OrganizationId)"
                  class="flex w-full items-center justify-between py-3 text-left"
                >
                  <div class="truncate-text font-medium">{{ org.Name }}</div>
                </div>
              </div>
            </template>
          </UDropdown>
        </div>
      </template>
      <template v-else>
        <div class="flex w-full flex-col items-center justify-center text-center">
          <img class="w-[140px]" src="@/assets/images/easy-genomics-logo.svg" alt="EasyGenomics logo" />
        </div>
      </template>
    </div>
  </header>

  <EGSwitchOrgModal v-model="switchOrgDialogOpen" :switch-to-org-id="switchToOrgId" />
</template>

<style scoped lang="scss">
  header {
    background-color: white;
    width: 100%;
    height: var(--header-height);
  }
  .header-container {
    width: 100%;
  }

  .ULink {
    line-height: 1.4rem;
  }

  .border-6 {
    border-width: 6px;
  }

  .truncate-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
