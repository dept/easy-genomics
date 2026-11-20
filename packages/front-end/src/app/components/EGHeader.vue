<script setup lang="ts">
  import { contextChipText } from '@FE/utils/org-lab-navigation';

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
  const labsStore = useLabsStore();

  const { signOutAndRedirect } = useAuth();
  const $router = useRouter();
  const $route = useRoute();
  const homePath = '/';
  const labsPath = '/labs';
  const orgsPath = '/orgs';

  function isSubpath(url: string) {
    return $router.currentRoute.value.path.includes(url);
  }

  function routeParam(name: string): string | null {
    const value = $route.params[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  const inOrgSettings = computed<boolean>(() => $route.path.startsWith(`${orgsPath}/`));

  const chipOrgName = computed<string | null>(() => {
    const orgId = (inOrgSettings.value ? routeParam('orgId') : null) ?? userStore.currentOrgId;
    return orgId ? (orgsStore.orgs[orgId]?.Name ?? null) : null;
  });

  const chipLabName = computed<string | null>(() => {
    const labId = routeParam('labId') ?? userStore.mostRecentLabId;
    return labId ? (labsStore.labs[labId]?.Name ?? null) : null;
  });

  const chip = computed(() =>
    contextChipText({ orgName: chipOrgName.value, labName: chipLabName.value, inOrgSettings: inOrgSettings.value }),
  );

  const chipAriaLabel = computed<string>(() => {
    const where = inOrgSettings.value
      ? `Organization settings for ${chipOrgName.value ?? 'your organization'}`
      : `Working in ${[chipLabName.value, chipOrgName.value].filter(Boolean).join(', ')}`;
    return `${where}. Switch organization or lab`;
  });

  const acctDropdownIsOpen = ref<boolean>(false);

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

  function onAccountMenuFocusOut(event: FocusEvent): void {
    const nextFocused = event.relatedTarget as Node | null;

    if (!acctDropdownIsOpen.value || !accountMenuRoot.value) {
      return;
    }

    if (!nextFocused || !accountMenuRoot.value.contains(nextFocused)) {
      closeAccountMenu();
    }
  }
</script>

<template>
  <header class="flex flex-row items-center px-4 md:px-8">
    <div
      class="header-container"
      :class="{ 'flex w-full min-w-0 flex-row items-center justify-between gap-3': props.isAuthed }"
    >
      <template v-if="props.isAuthed">
        <NuxtLink
          :to="homePath"
          class="focus-visible:outline-primary-500 mr-2 shrink-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label="Easy Genomics home"
        >
          <img class="w-[120px] md:w-[140px]" src="@/assets/images/easy-genomics-logo.svg" alt="EasyGenomics logo" />
        </NuxtLink>

        <div class="flex min-w-0 items-center gap-2 md:gap-4">
          <nav aria-label="Primary" class="flex min-w-0 items-center gap-2 md:gap-4">
            <NuxtLink
              v-if="!userStore.isSuperuser"
              :to="labsPath"
              :aria-current="$route.path === labsPath ? 'page' : undefined"
              :aria-label="chipAriaLabel"
              class="bg-primary-muted text-primary-dark focus-visible:outline-primary-500 flex h-11 min-w-0 max-w-[14rem] flex-col justify-center rounded-xl px-3 leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:max-w-[22rem] md:px-4"
            >
              <span v-if="chip.orgLine" class="truncate text-xs opacity-80">{{ chip.orgLine }}</span>
              <span class="truncate text-sm font-semibold">{{ chip.mainLine }}</span>
            </NuxtLink>
            <ULink
              v-else
              :to="orgsPath"
              :aria-current="isSubpath(orgsPath) ? 'page' : undefined"
              inactive-class="text-body"
              active-class="text-primary-dark bg-primary-muted"
              :class="isSubpath(orgsPath) ? 'text-primary-dark bg-primary-muted' : ''"
              class="ULink text-body focus-visible:outline-primary-500 flex h-[30px] shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3 py-1 font-serif text-sm tracking-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:px-4"
            >
              Organizations
            </ULink>
          </nav>

          <div ref="accountMenuRoot" class="relative shrink-0" @focusout="onAccountMenuFocusOut">
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
              <div class="bg-background-light-grey flex flex-col gap-1 p-4">
                <EGUserDisplay :initials="userStore.currentUserInitials" :name="userStore.currentUserDisplayName" />
                <span v-if="userStore.currentUserDetails.email" class="text-muted truncate text-sm">
                  {{ userStore.currentUserDetails.email }}
                </span>
              </div>

              <button
                v-if="!userStore.isSuperuser"
                type="button"
                class="focus-visible:outline-primary-500 w-full border-t px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                @click="goToProfile"
              >
                Edit profile
              </button>

              <button
                type="button"
                class="text-primary focus-visible:outline-primary-500 w-full border-t px-4 py-3 text-left underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                @click="onSignOut"
              >
                Sign out
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
