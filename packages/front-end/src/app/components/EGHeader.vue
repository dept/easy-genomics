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

  const accountMenuPanelId = 'account-menu-panel';
  const accountMenuRoot = ref<HTMLElement | null>(null);
  const accountMenuPanel = ref<HTMLElement | null>(null);
  const accountMenuTrigger = ref<HTMLButtonElement | null>(null);

  function closeAccountMenu(): void {
    acctDropdownIsOpen.value = false;
  }

  function openAccountMenu(): void {
    acctDropdownIsOpen.value = true;
  }

  function toggleAccountMenu(): void {
    acctDropdownIsOpen.value = !acctDropdownIsOpen.value;
  }

  function getMenuFocusables(): HTMLElement[] {
    if (!accountMenuPanel.value) {
      return [];
    }

    return Array.from(accountMenuPanel.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
  }

  function focusMenuItem(index: number): void {
    const focusables = getMenuFocusables();
    if (focusables.length === 0) {
      return;
    }

    const wrappedIndex = ((index % focusables.length) + focusables.length) % focusables.length;
    focusables[wrappedIndex]?.focus();
  }

  watch(acctDropdownIsOpen, async (isOpen) => {
    if (!isOpen) {
      return;
    }

    await nextTick();
    focusMenuItem(0);
  });

  onClickOutside(accountMenuRoot, () => {
    if (acctDropdownIsOpen.value) {
      closeAccountMenu();
    }
  });

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (acctDropdownIsOpen.value) {
        event.preventDefault();
        closeAccountMenu();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      if (!acctDropdownIsOpen.value) {
        event.preventDefault();
        openAccountMenu();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusMenuItem(0);
      }
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    const focusables = getMenuFocusables();
    const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      closeAccountMenu();
      accountMenuTrigger.value?.focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? 0 : currentIndex - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusMenuItem(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusMenuItem(focusables.length - 1);
    }
  }

  function goToProfile(): void {
    closeAccountMenu();
    $router.push('/profile');
  }

  function onSignOut(): void {
    closeAccountMenu();
    signOutAndRedirect();
  }

  function selectSwitchToOrg(orgId: string): void {
    closeAccountMenu();
    switchToOrgId.value = orgId;
    switchOrgDialogOpen.value = true;
  }

  function onAccountMenuFocusOut(event: FocusEvent): void {
    const nextFocused = event.relatedTarget as Node | null;

    if (!acctDropdownIsOpen.value || !accountMenuRoot.value) {
      return;
    }

    if (!nextFocused || !accountMenuRoot.value.contains(nextFocused)) {
      closeAccountMenu();
    }
  }

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
          <nav aria-label="Primary" class="flex items-center gap-4">
            <ULink
              v-if="!userStore.isSuperuser"
              :to="labsPath"
              :aria-current="isSubpath(labsPath) ? 'page' : undefined"
              inactive-class="text-body"
              active-class="text-primary-dark bg-primary-muted"
              :class="isSubpath(labsPath) ? 'text-primary-dark bg-primary-muted' : ''"
              class="ULink text-body focus-visible:outline-primary-500 flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl px-4 py-1 font-serif text-sm tracking-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Labs
            </ULink>
            <ULink
              v-if="userStore.canManageAnyOrgs()"
              :to="orgsPath"
              :aria-current="isSubpath(orgsPath) ? 'page' : undefined"
              inactive-class="text-body"
              active-class="text-primary-dark bg-primary-muted"
              :class="isSubpath(orgsPath) ? 'text-primary-dark bg-primary-muted' : ''"
              class="ULink text-body focus-visible:outline-primary-500 flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl px-4 py-1 font-serif text-sm tracking-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Organizations
            </ULink>
          </nav>

          <div ref="accountMenuRoot" class="relative" @focusout="onAccountMenuFocusOut">
            <button
              ref="accountMenuTrigger"
              type="button"
              class="focus-visible:outline-primary-500 rounded-lg p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label="Account menu"
              :aria-expanded="acctDropdownIsOpen"
              aria-haspopup="true"
              :aria-controls="accountMenuPanelId"
              @click="toggleAccountMenu"
              @keydown="onTriggerKeydown"
            >
              <EGUserDisplay :initials="userStore.currentUserInitials" aria-hidden="true" />
            </button>

            <div
              v-if="acctDropdownIsOpen"
              :id="accountMenuPanelId"
              ref="accountMenuPanel"
              role="region"
              aria-label="Account menu"
              class="account-menu-panel absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
              @keydown="onPanelKeydown"
            >
              <button
                v-if="!userStore.isSuperuser"
                type="button"
                class="bg-background-light-grey focus-visible:outline-primary-500 flex w-full flex-row items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                @click="goToProfile"
              >
                <EGUserDisplay
                  class="grow"
                  :initials="userStore.currentUserInitials"
                  :name="userStore.currentUserDisplayName"
                  :organization="orgsStore.orgs[userStore.currentOrgId]?.Name ?? null"
                />
                <UIcon name="i-heroicons-chevron-right" class="h-6 w-6 shrink-0" aria-hidden="true" />
              </button>
              <div v-else class="bg-background-light-grey p-4">
                <EGUserDisplay
                  :initials="userStore.currentUserInitials"
                  :name="userStore.currentUserDisplayName"
                  :organization="orgsStore.orgs[userStore.currentOrgId]?.Name ?? null"
                />
              </div>

              <div v-if="!userStore.isSuperuser && otherOrgs.length > 0" class="bg-background-light-grey px-4 pb-2">
                <div id="other-orgs-heading" class="text-muted pt-2">Other Organizations</div>

                <div role="group" aria-labelledby="other-orgs-heading" class="flex w-full flex-col items-start">
                  <div v-for="(org, i) of otherOrgs" :key="org.OrganizationId" class="flex w-full flex-col items-start">
                    <div v-if="i > 0" class="w-full border-t" role="presentation" />

                    <button
                      type="button"
                      class="focus-visible:outline-primary-500 flex min-h-[44px] w-full items-center justify-between py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      @click="selectSwitchToOrg(org.OrganizationId)"
                    >
                      <span class="truncate-text font-medium">{{ org.Name }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="text-primary focus-visible:outline-primary-500 w-full p-4 text-left underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                @click="onSignOut"
              >
                Sign Out
              </button>
            </div>
          </div>
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
