<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import {
    type BatchLaboratoryWorkflowAccessAssignment,
    type LaboratoryWorkflowAccess,
    type UnifiedWorkflowCatalogEntry,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
  import { parseWorkflowAccessSortKey } from '@easy-genomics/shared-lib/src/app/utils/laboratory-workflow-access-key';

  const $route = useRoute();
  const orgId = $route.params.orgId as string;
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

  async function load() {
    isLoading.value = true;
    try {
      const [catalogRes, labsRes, assignRes] = await Promise.all([
        $api.workflowAccess.listCatalog(orgId),
        $api.labs.list(orgId),
        $api.workflowAccess.listAssignments(orgId),
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
      await $api.workflowAccess.batchUpdate(orgId, { assignments });
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
    title="Workflow lab access"
    description="Grant labs access to HealthOmics workflows and Seqera pipelines for this organization."
    :back-action="() => $router.push(`/admin/orgs/${orgId}`)"
    :show-back="true"
    :is-loading="isLoading"
  />

  <div v-if="!isLoading" class="mt-6 flex flex-col gap-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <EGCard class="w-full shrink-0 lg:w-72">
        <div class="text-text-muted mb-3 text-xs font-semibold uppercase tracking-wide">Lab</div>
        <ul class="space-y-2">
          <li v-for="lab in laboratories" :key="lab.LaboratoryId">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              :class="
                selectedLabId === lab.LaboratoryId
                  ? 'border-primary bg-primary/10'
                  : 'border-background-dark-grey hover:bg-background-light-grey'
              "
              @click="selectLab(lab.LaboratoryId)"
            >
              <span class="text-text-body">&bull;</span>
              <span class="flex-1 truncate font-medium">{{ lab.Name }}</span>
              <UBadge size="xs" variant="subtle">
                {{ countForLab(lab.LaboratoryId).assigned }}/{{ countForLab(lab.LaboratoryId).total }}
              </UBadge>
            </button>
          </li>
        </ul>
        <p v-if="!laboratories.length" class="text-text-muted text-sm">No laboratories in this organization.</p>
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
                      :class="
                        row.platform === 'HealthOmics'
                          ? 'bg-violet-700 text-white dark:bg-violet-600'
                          : 'bg-blue-600 text-white dark:bg-blue-500'
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

    <div class="flex flex-wrap gap-3">
      <EGButton label="Discard all" variant="secondary" :disabled="!isDirty || isSaving" @click="discardAll" />
      <EGButton label="Save all changes" :disabled="!isDirty || isSaving" :loading="isSaving" @click="saveAll" />
    </div>
  </div>
</template>
