<script setup lang="ts">
  import type { UpdateLaboratory } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    type BatchLaboratoryS3AccessAssignment,
    type LaboratoryS3Access,
    type S3BucketCatalogEntry,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';

  const props = withDefaults(
    defineProps<{
      orgId: string;
      backPath?: string;
      embedded?: boolean;
      headingId?: string;
    }>(),
    {
      backPath: '',
      embedded: false,
      headingId: 's3-lab-access-heading',
    },
  );

  const labListId = 's3-access-lab-list';
  const bucketTableHeadingId = 's3-access-table-heading';
  const defaultBucketsHelpId = 's3-access-default-buckets-help';
  const saveStatusId = 's3-access-save-status';

  const $router = useRouter();
  const { $api } = useNuxtApp();

  const catalog = ref<S3BucketCatalogEntry[]>([]);
  const laboratories = ref<Laboratory[]>([]);
  const selectedLabId = ref<string | null>(null);
  const isLoading = ref(true);
  const isSaving = ref(false);

  const baselineKeys = ref<Set<string>>(new Set());
  const pendingKeys = ref<Set<string>>(new Set());

  const baselineEnableNewByDefault = ref<Record<string, boolean>>({});
  const pendingEnableNewByDefault = ref<Record<string, boolean>>({});

  function rowIsDeny(a: LaboratoryS3Access): boolean {
    return a.Effect === 'DENY';
  }

  function accessKey(laboratoryId: string, bucketName: string): string {
    return `${laboratoryId}::${bucketName}`;
  }

  function assignmentsToGrantedKeys(
    assignments: LaboratoryS3Access[],
    labs: Laboratory[],
    cat: S3BucketCatalogEntry[],
  ): Set<string> {
    const denyByLab = new Map<string, Set<string>>();
    const allowByLab = new Map<string, Set<string>>();

    for (const a of assignments) {
      const k = accessKey(a.LaboratoryId, a.BucketName);
      if (rowIsDeny(a)) {
        if (!denyByLab.has(a.LaboratoryId)) {
          denyByLab.set(a.LaboratoryId, new Set());
        }
        denyByLab.get(a.LaboratoryId)!.add(k);
      } else {
        if (!allowByLab.has(a.LaboratoryId)) {
          allowByLab.set(a.LaboratoryId, new Set());
        }
        allowByLab.get(a.LaboratoryId)!.add(k);
      }
    }

    const granted = new Set<string>();
    for (const lab of labs) {
      const defaultOn = lab.EnableNewBucketsByDefault === true;
      for (const row of cat) {
        const k = accessKey(lab.LaboratoryId, row.name);
        if (defaultOn) {
          if (!denyByLab.get(lab.LaboratoryId)?.has(k)) {
            granted.add(k);
          }
        } else if (allowByLab.get(lab.LaboratoryId)?.has(k)) {
          granted.add(k);
        }
      }
    }
    return granted;
  }

  function initDefaultFlagsFromLabs() {
    const b: Record<string, boolean> = {};
    const p: Record<string, boolean> = {};
    for (const lab of laboratories.value) {
      const v = lab.EnableNewBucketsByDefault === true;
      b[lab.LaboratoryId] = v;
      p[lab.LaboratoryId] = v;
    }
    baselineEnableNewByDefault.value = b;
    pendingEnableNewByDefault.value = { ...p };
  }

  function countForLab(labId: string): { assigned: number; total: number } {
    const total = catalog.value.length;
    let assigned = 0;
    for (const row of catalog.value) {
      if (pendingKeys.value.has(accessKey(labId, row.name))) {
        assigned++;
      }
    }
    return { assigned, total };
  }

  const isDirty = computed(() => {
    if (baselineKeys.value.size !== pendingKeys.value.size) {
      return true;
    }
    for (const k of baselineKeys.value) {
      if (!pendingKeys.value.has(k)) {
        return true;
      }
    }
    for (const k of pendingKeys.value) {
      if (!baselineKeys.value.has(k)) {
        return true;
      }
    }
    for (const lab of laboratories.value) {
      const id = lab.LaboratoryId;
      if (pendingEnableNewByDefault.value[id] !== baselineEnableNewByDefault.value[id]) {
        return true;
      }
    }
    return false;
  });

  function keysForLaboratory(laboratoryId: string, keySet: Set<string>): Set<string> {
    const prefix = `${laboratoryId}::`;
    const out = new Set<string>();
    for (const k of keySet) {
      if (k.startsWith(prefix)) {
        out.add(k);
      }
    }
    return out;
  }

  function isLabDirty(laboratoryId: string): boolean {
    if (pendingEnableNewByDefault.value[laboratoryId] !== baselineEnableNewByDefault.value[laboratoryId]) {
      return true;
    }
    const baselineForLab = keysForLaboratory(laboratoryId, baselineKeys.value);
    const pendingForLab = keysForLaboratory(laboratoryId, pendingKeys.value);
    if (baselineForLab.size !== pendingForLab.size) {
      return true;
    }
    for (const k of baselineForLab) {
      if (!pendingForLab.has(k)) {
        return true;
      }
    }
    for (const k of pendingForLab) {
      if (!baselineForLab.has(k)) {
        return true;
      }
    }
    return false;
  }

  const labsWithUnsavedChanges = computed(() => laboratories.value.filter((l) => isLabDirty(l.LaboratoryId)));

  const selectedLab = computed(() => laboratories.value.find((l) => l.LaboratoryId === selectedLabId.value));

  function buildUpdateLaboratoryPayload(lab: Laboratory): UpdateLaboratory {
    return {
      Name: lab.Name,
      Status: lab.Status,
      Description: lab.Description,
      S3Bucket: lab.S3Bucket,
      AwsHealthOmicsEnabled: lab.AwsHealthOmicsEnabled,
      NextFlowTowerEnabled: lab.NextFlowTowerEnabled,
      NextFlowTowerApiBaseUrl: lab.NextFlowTowerApiBaseUrl,
      NextFlowTowerWorkspaceId: lab.NextFlowTowerWorkspaceId,
      RunRetentionMonths: lab.RunRetentionMonths,
      EnableNewWorkflowsByDefault: lab.EnableNewWorkflowsByDefault,
      EnableNewBucketsByDefault: pendingEnableNewByDefault.value[lab.LaboratoryId],
    };
  }

  async function load() {
    isLoading.value = true;
    try {
      const [catalogRes, labsRes, assignRes] = await Promise.all([
        $api.s3Access.listCatalog(props.orgId),
        $api.labs.list(props.orgId),
        $api.s3Access.listAssignments(props.orgId),
      ]);
      catalog.value = catalogRes.buckets;
      laboratories.value = labsRes ?? [];
      initDefaultFlagsFromLabs();
      const base = assignmentsToGrantedKeys(assignRes.assignments, laboratories.value, catalog.value);
      baselineKeys.value = base;
      pendingKeys.value = new Set(base);
      if (laboratories.value.length && !selectedLabId.value) {
        selectedLabId.value = laboratories.value[0].LaboratoryId;
      }
    } catch (e) {
      console.error(e);
      useToastStore().error('Failed to load S3 access data');
    } finally {
      isLoading.value = false;
    }
  }

  onMounted(() => load());

  function selectLab(labId: string) {
    selectedLabId.value = labId;
  }

  function labButtonId(labId: string): string {
    return `s3-access-lab-${labId}`;
  }

  function focusLabButton(labId: string) {
    nextTick(() => {
      document.getElementById(labButtonId(labId))?.focus();
    });
  }

  function labAriaLabel(lab: Laboratory): string {
    const { assigned, total } = countForLab(lab.LaboratoryId);
    const dirty = isLabDirty(lab.LaboratoryId) ? ', unsaved changes' : '';
    return `Select laboratory ${lab.Name}, ${assigned} of ${total} buckets assigned${dirty}`;
  }

  function onLabKeydown(event: KeyboardEvent, index: number) {
    const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!navigationKeys.includes(event.key)) return;

    event.preventDefault();
    const count = laboratories.value.length;
    if (count === 0) return;

    let nextIndex = index;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = index <= 0 ? count - 1 : index - 1;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = index >= count - 1 ? 0 : index + 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = count - 1;
    }

    const nextLab = laboratories.value[nextIndex];
    if (!nextLab) return;
    selectLab(nextLab.LaboratoryId);
    focusLabButton(nextLab.LaboratoryId);
  }

  const saveStatusMessage = computed(() => {
    if (isLoading.value) return 'Loading S3 access data…';
    if (isSaving.value) return 'Saving S3 access changes…';
    if (!isDirty.value) return '';
    const count = labsWithUnsavedChanges.value.length;
    if (count === 0) return 'You have unsaved S3 access changes.';
    const noun = count === 1 ? 'laboratory has' : 'laboratories have';
    return `${count} ${noun} unsaved S3 access changes.`;
  });

  function setGranted(labId: string, row: S3BucketCatalogEntry, granted: boolean) {
    const k = accessKey(labId, row.name);
    const next = new Set(pendingKeys.value);
    if (granted) {
      next.add(k);
    } else {
      next.delete(k);
    }
    pendingKeys.value = next;
  }

  function setEnableNewBucketsForSelectedLab(value: boolean) {
    if (!selectedLabId.value) {
      return;
    }
    pendingEnableNewByDefault.value = {
      ...pendingEnableNewByDefault.value,
      [selectedLabId.value]: value,
    };
  }

  function discardAll() {
    pendingKeys.value = new Set(baselineKeys.value);
    pendingEnableNewByDefault.value = { ...baselineEnableNewByDefault.value };
  }

  async function saveAll() {
    isSaving.value = true;
    try {
      for (const lab of laboratories.value) {
        const id = lab.LaboratoryId;
        if (pendingEnableNewByDefault.value[id] !== baselineEnableNewByDefault.value[id]) {
          await $api.labs.update(id, buildUpdateLaboratoryPayload(lab));
        }
      }

      const prev = baselineKeys.value;
      const next = pendingKeys.value;
      const assignments: BatchLaboratoryS3AccessAssignment[] = [];

      const allKeys = new Set([...prev, ...next]);
      for (const key of allKeys) {
        const sep = key.indexOf('::');
        const laboratoryId = key.slice(0, sep);
        const bucketName = key.slice(sep + 2);
        if (!laboratoryId || !bucketName) {
          continue;
        }
        const inPrev = prev.has(key);
        const inNext = next.has(key);
        if (inPrev === inNext) {
          continue;
        }
        assignments.push({
          laboratoryId,
          bucketName,
          granted: inNext,
        });
      }

      if (assignments.length) {
        await $api.s3Access.batchUpdate(props.orgId, { assignments });
      }

      await load();
      useToastStore().success('S3 access saved');
    } catch (e) {
      console.error(e);
      useToastStore().error('Failed to save S3 access');
    } finally {
      isSaving.value = false;
    }
  }
</script>

<template>
  <div :aria-busy="isLoading || isSaving">
    <p :id="saveStatusId" class="sr-only" aria-live="polite" aria-atomic="true">{{ saveStatusMessage }}</p>

    <EGText v-if="embedded" :id="headingId" tag="h2" class="sr-only">S3 access</EGText>

    <EGPageHeader
      v-if="!embedded"
      :title-id="headingId"
      title="S3 lab access"
      description="Grant labs access to organization data S3 buckets. When “new buckets by default” is on, unlisted buckets stay allowed unless you turn them off."
      :back-action="() => $router.push(props.backPath)"
      :show-back="true"
      :is-loading="isLoading"
    />

    <div v-if="isLoading" class="text-text-muted py-10 text-center font-serif text-sm" role="status">
      Loading S3 access…
    </div>

    <div v-else :class="embedded ? 'flex flex-col gap-6' : 'mt-6 flex flex-col gap-6'">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <EGCard class="block w-full min-w-0 shrink-0 lg:w-72">
          <div class="w-full min-w-0">
            <div :id="labListId" class="text-text-muted mb-3 text-xs font-semibold uppercase tracking-wide">Lab</div>
            <div class="flex w-full flex-col gap-2" role="radiogroup" aria-labelledby="labListId">
              <button
                v-for="(lab, index) in laboratories"
                :key="lab.LaboratoryId"
                :id="labButtonId(lab.LaboratoryId)"
                type="button"
                role="radio"
                class="focus-visible:outline-primary-500 box-border flex w-full min-w-0 max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left font-serif text-sm transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                :aria-checked="selectedLabId === lab.LaboratoryId"
                :aria-label="labAriaLabel(lab)"
                :class="
                  selectedLabId === lab.LaboratoryId
                    ? 'bg-primary-muted text-primary-dark border-transparent'
                    : 'border-background-dark-grey text-body hover:bg-background-light-grey'
                "
                @click="selectLab(lab.LaboratoryId)"
                @keydown="onLabKeydown($event, index)"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="selectedLabId === lab.LaboratoryId ? 'bg-primary-dark' : 'bg-body'"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate font-medium">{{ lab.Name }}</span>
                <span
                  v-if="isLabDirty(lab.LaboratoryId)"
                  class="bg-alert-caution h-1.5 w-1.5 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <UBadge
                  size="xs"
                  class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif ring-0"
                  aria-hidden="true"
                >
                  {{ countForLab(lab.LaboratoryId).assigned }}/{{ countForLab(lab.LaboratoryId).total }}
                </UBadge>
              </button>
            </div>
            <p v-if="!laboratories.length" class="text-text-muted text-sm" role="status">
              No laboratories in this organization.
            </p>
          </div>
        </EGCard>

        <EGCard class="min-w-0 flex-1">
          <template v-if="selectedLabId && selectedLab">
            <div
              class="border-background-dark-grey mb-4 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div class="text-text-body font-serif font-medium">Enable new buckets by default</div>
                <p :id="defaultBucketsHelpId" class="text-text-muted mt-1 max-w-xl text-xs">
                  When on, newly added data buckets are allowed for this lab until you turn them off here. When off,
                  only buckets you enable are allowed.
                </p>
              </div>
              <UToggle
                :model-value="pendingEnableNewByDefault[selectedLabId] === true"
                :aria-label="`Enable new buckets by default for ${selectedLab.Name}`"
                :aria-describedby="defaultBucketsHelpId"
                @update:model-value="setEnableNewBucketsForSelectedLab"
              />
            </div>
            <div class="overflow-x-auto">
              <h3 :id="bucketTableHeadingId" class="sr-only">S3 bucket access for {{ selectedLab.Name }}</h3>
              <table class="w-full min-w-[520px] text-left text-sm" :aria-labelledby="bucketTableHeadingId">
                <thead>
                  <tr class="border-background-dark-grey text-text-muted border-b text-xs font-semibold uppercase">
                    <th scope="col" class="pb-3 pr-4">Bucket</th>
                    <th scope="col" class="pb-3">Access</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in catalog" :key="row.name" class="border-background-dark-grey/60 border-b">
                    <td class="py-3 pr-4">
                      <div class="text-text-body font-mono text-xs font-medium">{{ row.name }}</div>
                    </td>
                    <td class="py-3">
                      <UToggle
                        :model-value="pendingKeys.has(accessKey(selectedLabId, row.name))"
                        :aria-label="`${pendingKeys.has(accessKey(selectedLabId, row.name)) ? 'Revoke' : 'Grant'} access to ${row.name} for ${selectedLab.Name}`"
                        @update:model-value="(v: boolean) => setGranted(selectedLabId!, row, v)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="!catalog.length" class="text-text-muted text-sm" role="status">
              No data buckets found in this deployment.
            </p>
          </template>
          <p v-else class="text-text-muted text-sm" role="status">Select a laboratory.</p>
        </EGCard>
      </div>

      <div class="flex flex-col items-end gap-3" :aria-describedby="isDirty ? saveStatusId : undefined">
        <ul
          v-if="labsWithUnsavedChanges.length"
          class="text-text-body m-0 flex w-full list-none flex-col items-end gap-1 p-0 text-right font-serif text-sm"
          aria-label="Labs with unsaved changes"
        >
          <li
            v-for="lab in labsWithUnsavedChanges"
            :key="lab.LaboratoryId"
            class="flex max-w-full items-center justify-end gap-2"
          >
            <span class="bg-alert-caution h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
            <span class="truncate">{{ lab.Name }}</span>
          </li>
        </ul>
        <div class="flex flex-wrap justify-end gap-3">
          <EGButton
            u-button-type="button"
            label="Discard all"
            variant="secondary"
            :disabled="!isDirty || isSaving"
            @click="discardAll"
          />
          <EGButton
            u-button-type="button"
            label="Save all changes"
            :disabled="!isDirty || isSaving"
            :loading="isSaving"
            :aria-describedby="saveStatusId"
            @click="saveAll"
          />
        </div>
      </div>
    </div>
  </div>
</template>
