<script setup lang="ts">
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

  const router = useRouter();
  const route = useRoute();

  const labsStore = useLabsStore();
  const userStore = useUserStore();

  const labId = route.params.labId as string;

  const isOpen = ref<boolean>(false);

  const currentOrgId = computed<string | null>(
    () => (userStore.isSuperuser ? (route.params.orgId as string) : userStore.currentOrgId) ?? null,
  );

  onBeforeMount(async () => {
    // there are some cases (eg. sign in straight to a lab page) where the labs might not have been loaded
    // in that case we'll fetch them now

    if (currentOrgId.value === null) return; // this is probably a problem but nothing we can do

    if (!(currentOrgId.value in labsStore.labIdsByOrg)) {
      await labsStore.loadLabsForOrg(currentOrgId.value);
    }
  });

  const currentLab = computed<Laboratory | null>(() => labsStore.labs[labId] || null);

  const otherLabs = computed<Laboratory[]>(() => {
    // for superuser, use the org in the url; for normal user, currentOrgId
    return Object.values(labsStore.labsForOrg(currentOrgId.value || ''))
      .filter((lab) => lab.LaboratoryId !== labId)
      .sort((a, b) => useSort().stringSortCompare(a.Name, b.Name));
  });

  const items = computed<Laboratory[][]>(() =>
    otherLabs.value.map((lab) => [
      {
        ...lab,
        click: () => doSwitchLab(lab.LaboratoryId),
      },
    ]),
  );

  function doSwitchLab(targetLabId: string): void {
    // this is flexible enough to work in most different contexts; eg.
    // - normal user: /labs/[labId]
    // - superuser: /orgs/[orgId]/labs/[labId]
    const newRoute = route.fullPath.replace(/\/labs\/.+/, `/labs/${targetLabId}`);
    router.push(newRoute);
  }
</script>

<template>
  <div>
    <UDropdown v-model:open="isOpen" :items="items" :popper="{ placement: 'bottom-start' }">
      <div class="font-schibsted">
        <UButton
          variant="ghost"
          :trailing-icon="items.length > 0 ? 'i-heroicons-chevron-up-down' : undefined"
          color="black"
          :aria-label="items.length > 0 ? `Lab: ${currentLab?.Name}. Switch lab` : `Lab: ${currentLab?.Name}`"
          :aria-expanded="items.length > 0 ? isOpen : undefined"
          :aria-haspopup="items.length > 0 ? 'menu' : undefined"
        >
          {{ currentLab?.Name }}
        </UButton>
      </div>
      <template #item="{ item }">
        <span class="w-full text-left">{{ item.Name }}</span>
      </template>
    </UDropdown>
  </div>
</template>
