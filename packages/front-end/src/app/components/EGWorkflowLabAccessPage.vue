<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    type BatchLaboratoryWorkflowAccessAssignment,
    type LaboratoryWorkflowAccess,
    type UnifiedWorkflowCatalogEntry,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
  import { parseWorkflowAccessSortKey } from '@easy-genomics/shared-lib/src/app/utils/laboratory-workflow-access-key';

  const props = withDefaults(
    defineProps<{
      orgId: string;
      backPath?: string;
      /** When true, hide page header (e.g. org hub tab). */
      embedded?: boolean;
    }>(),
    {
      backPath: '',
      embedded: false,
    },
  );

  const $router = useRouter();
  const { $api } = useNuxtApp();

  const catalog = ref<UnifiedWorkflowCatalogEntry[]>([]);
  const laboratories = ref<Laboratory[]>([]);
  const selectedLabId = ref<string | null>(null);
  const isLoading = ref(true);
  const isSaving = ref(false);

  const baselineKeys = ref<Set<string>>(new Set());
  const pendingKeys = ref<Set<string>>(new Set());

  function toApiPlatform(row: UnifiedWorkflowCatalogEntry): 'HEALTH_OMICS' | 'SEQERA' {
    return row.platform === 'HealthOmics' ? 'HEALTH_OMICS' : 'SEQERA';
  }

  function accessKey(laboratoryId: string, row: UnifiedWorkflowCatalogEntry): string {
    return `${laboratoryId}::${toApiPlatform(row)}::${row.workflowId}`;
  }

  function assignmentsToKeys(assignments: LaboratoryWorkflowAccess[]): Set<string> {
    const s = new Set<string>();
    for (const a of assignments) {
      const parsed = parseWorkflowAccessSortKey(a.WorkflowKey);
      if (!parsed) {
        continue;
      }
      s.add(`${a.LaboratoryId}::${parsed.platform}::${parsed.workflowId}`);
    }
    return s;
  }

  function countForLab(labId: string): { assigned: number; total: number } {
    const total = catalog.value.length;
    let assigned = 0;
    for (const row of catalog.value) {
      if (pendingKeys.value.has(accessKey(labId, row))) {
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
    return false;
  }

  const labsWithUnsavedChanges = computed(() => laboratories.value.filter((l) => isLabDirty(l.LaboratoryId)));

  async function load() {
    isLoading.value = true;
    try {
      const [catalogRes, labsRes, assignRes] = await Promise.all([
        $api.workflowAccess.listCatalog(props.orgId),
        $api.labs.list(props.orgId),
        $api.workflowAccess.listAssignments(props.orgId),
      ]);
      catalog.value = catalogRes.workflows;
      laboratories.value = labsRes ?? [];
      const base = assignmentsToKeys(assignRes.assignments);
      baselineKeys.value = base;
      pendingKeys.value = new Set(base);
      if (laboratories.value.length && !selectedLabId.value) {
        selectedLabId.value = laboratories.value[0].LaboratoryId;
      }
    } catch (e) {
      console.error(e);
      useToastStore().error('Failed to load workflow access data');
    } finally {
      isLoading.value = false;
    }
  }

  onMounted(() => load());

  function selectLab(labId: string) {
    selectedLabId.value = labId;
  }

  function setGranted(labId: string, row: UnifiedWorkflowCatalogEntry, granted: boolean) {
    const k = accessKey(labId, row);
    const next = new Set(pendingKeys.value);
    if (granted) {
      next.add(k);
    } else {
      next.delete(k);
    }
    pendingKeys.value = next;
  }

  function discardAll() {
    pendingKeys.value = new Set(baselineKeys.value);
  }

  async function saveAll() {
    const prev = baselineKeys.value;
    const next = pendingKeys.value;
    const assignments: BatchLaboratoryWorkflowAccessAssignment[] = [];

    const allKeys = new Set([...prev, ...next]);
    for (const key of allKeys) {
      const parts = key.split('::');
      const laboratoryId = parts[0];
      const platform = parts[1];
      const workflowId = parts.slice(2).join('::');
      if (!laboratoryId || !platform || !workflowId) {
        continue;
      }
      const inPrev = prev.has(key);
      const inNext = next.has(key);
      if (inPrev === inNext) {
        continue;
      }
      const catalogRow = catalog.value.find((r) => toApiPlatform(r) === platform && r.workflowId === workflowId);
      assignments.push({
        laboratoryId,
        platform: platform as 'HEALTH_OMICS' | 'SEQERA',
        workflowId,
        workflowName: catalogRow?.name,
        granted: inNext,
      });
    }

    if (!assignments.length) {
      return;
    }
    isSaving.value = true;
    try {
      await $api.workflowAccess.batchUpdate(props.orgId, { assignments });
      baselineKeys.value = new Set(next);
      useToastStore().success('Workflow access saved');
    } catch (e) {
      console.error(e);
      useToastStore().error('Failed to save workflow access');
    } finally {
      isSaving.value = false;
    }
  }
</script>

<template>
  <EGPageHeader
    v-if="!embedded"
    title="Workflow lab access"
    description="Grant labs access to HealthOmics workflows and Seqera pipelines for this organization."
    :back-action="() => $router.push(props.backPath)"
    :show-back="true"
    :is-loading="isLoading"
  />

  <div v-if="embedded && isLoading" class="text-text-muted py-10 text-center font-serif text-sm">Loading…</div>

  <div v-else-if="!isLoading" :class="embedded ? 'flex flex-col gap-6' : 'mt-6 flex flex-col gap-6'">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <EGCard class="block w-full min-w-0 shrink-0 lg:w-72">
        <div class="w-full min-w-0">
          <div class="text-text-muted mb-3 text-xs font-semibold uppercase tracking-wide">Lab</div>
          <div class="flex w-full flex-col gap-2">
            <button
              v-for="lab in laboratories"
              :key="lab.LaboratoryId"
              type="button"
              class="box-border flex w-full min-w-0 max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left font-serif text-sm transition-colors"
              :class="
                selectedLabId === lab.LaboratoryId
                  ? 'bg-primary-muted text-primary-dark border-transparent'
                  : 'border-background-dark-grey text-body hover:bg-background-light-grey'
              "
              @click="selectLab(lab.LaboratoryId)"
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
                title="Unsaved changes"
                aria-hidden="true"
              />
              <UBadge
                size="xs"
                class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif ring-0"
              >
                {{ countForLab(lab.LaboratoryId).assigned }}/{{ countForLab(lab.LaboratoryId).total }}
              </UBadge>
            </button>
          </div>
          <p v-if="!laboratories.length" class="text-text-muted text-sm">No laboratories in this organization.</p>
        </div>
      </EGCard>

      <EGCard class="min-w-0 flex-1">
        <template v-if="selectedLabId">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr class="border-background-dark-grey text-text-muted border-b text-xs font-semibold uppercase">
                  <th class="pb-3 pr-4">Workflow</th>
                  <th class="pb-3 pr-4">Type</th>
                  <th class="pb-3">Access</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in catalog"
                  :key="`${row.platform}-${row.workflowId}`"
                  class="border-background-dark-grey/60 border-b"
                >
                  <td class="py-3 pr-4">
                    <div class="text-text-body font-medium">{{ row.name }}</div>
                    <div class="text-text-muted text-xs">{{ row.workflowId }}</div>
                  </td>
                  <td class="py-3 pr-4">
                    <UBadge
                      size="sm"
                      class="rounded-xl border-0 font-serif ring-0"
                      :class="
                        row.platform === 'HealthOmics'
                          ? 'bg-primary-muted text-primary-dark'
                          : 'bg-alert-blue-muted text-alert-blue'
                      "
                    >
                      {{ row.platform === 'HealthOmics' ? 'HealthOmics' : 'Seqera' }}
                    </UBadge>
                  </td>
                  <td class="py-3">
                    <UToggle
                      :model-value="pendingKeys.has(accessKey(selectedLabId, row))"
                      @update:model-value="(v: boolean) => setGranted(selectedLabId!, row, v)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!catalog.length" class="text-text-muted text-sm">
            No workflows found. Enable Omics or Seqera on at least one lab and ensure workflows exist in the account.
          </p>
        </template>
        <p v-else class="text-text-muted text-sm">Select a laboratory.</p>
      </EGCard>
    </div>

    <div class="flex flex-col items-end gap-3">
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
        <EGButton label="Discard all" variant="secondary" :disabled="!isDirty || isSaving" @click="discardAll" />
        <EGButton label="Save all changes" :disabled="!isDirty || isSaving" :loading="isSaving" @click="saveAll" />
      </div>
    </div>
  </div>
</template>
