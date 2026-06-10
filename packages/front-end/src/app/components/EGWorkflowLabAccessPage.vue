<script setup lang="ts">
  import type { UpdateLaboratory } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
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
      /** Optional id for the page heading when embedded in a tab panel. */
      headingId?: string;
    }>(),
    {
      backPath: '',
      embedded: false,
      headingId: 'workflow-lab-access-heading',
    },
  );

  const labListId = 'workflow-access-lab-list';
  const workflowTableHeadingId = 'workflow-access-table-heading';
  const defaultWorkflowsHelpId = 'workflow-access-default-workflows-help';
  const saveStatusId = 'workflow-access-save-status';

  const $router = useRouter();
  const { $api } = useNuxtApp();

  const catalog = ref<UnifiedWorkflowCatalogEntry[]>([]);
  const laboratories = ref<Laboratory[]>([]);
  const selectedLabId = ref<string | null>(null);
  const isLoading = ref(true);
  const isSaving = ref(false);

  const baselineKeys = ref<Set<string>>(new Set());
  const pendingKeys = ref<Set<string>>(new Set());

  const baselineEnableNewByDefault = ref<Record<string, boolean>>({});
  const pendingEnableNewByDefault = ref<Record<string, boolean>>({});

  function rowIsDeny(a: LaboratoryWorkflowAccess): boolean {
    return a.Effect === 'DENY';
  }

  function toApiPlatform(row: UnifiedWorkflowCatalogEntry): 'HEALTH_OMICS' | 'SEQERA' {
    return row.platform === 'HealthOmics' ? 'HEALTH_OMICS' : 'SEQERA';
  }

  function accessKey(laboratoryId: string, row: UnifiedWorkflowCatalogEntry): string {
    return `${laboratoryId}::${toApiPlatform(row)}::${row.workflowId}`;
  }

  function assignmentsToGrantedKeys(
    assignments: LaboratoryWorkflowAccess[],
    labs: Laboratory[],
    cat: UnifiedWorkflowCatalogEntry[],
  ): Set<string> {
    const denyByLab = new Map<string, Set<string>>();
    const allowByLab = new Map<string, Set<string>>();

    for (const a of assignments) {
      const parsed = parseWorkflowAccessSortKey(a.WorkflowKey);
      if (!parsed) {
        continue;
      }
      const k = `${a.LaboratoryId}::${parsed.platform}::${parsed.workflowId}`;
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
      const defaultOn = lab.EnableNewWorkflowsByDefault === true;
      for (const row of cat) {
        const k = accessKey(lab.LaboratoryId, row);
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
      const v = lab.EnableNewWorkflowsByDefault === true;
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
      EnableNewWorkflowsByDefault: pendingEnableNewByDefault.value[lab.LaboratoryId],
    };
  }

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
      initDefaultFlagsFromLabs();
      const base = assignmentsToGrantedKeys(assignRes.assignments, laboratories.value, catalog.value);
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

  function labButtonId(labId: string): string {
    return `workflow-access-lab-${labId}`;
  }

  function focusLabButton(labId: string) {
    nextTick(() => {
      document.getElementById(labButtonId(labId))?.focus();
    });
  }

  function labAriaLabel(lab: Laboratory): string {
    const { assigned, total } = countForLab(lab.LaboratoryId);
    const dirty = isLabDirty(lab.LaboratoryId) ? ', unsaved changes' : '';
    return `Select laboratory ${lab.Name}, ${assigned} of ${total} workflows assigned${dirty}`;
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
    if (isLoading.value) return 'Loading workflow access data…';
    if (isSaving.value) return 'Saving workflow access changes…';
    if (!isDirty.value) return '';
    const count = labsWithUnsavedChanges.value.length;
    if (count === 0) return 'You have unsaved workflow access changes.';
    const noun = count === 1 ? 'laboratory has' : 'laboratories have';
    return `${count} ${noun} unsaved workflow access changes.`;
  });

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

  function setEnableNewWorkflowsForSelectedLab(value: boolean) {
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

      if (assignments.length) {
        await $api.workflowAccess.batchUpdate(props.orgId, { assignments });
      }

      await load();
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
  <div :aria-busy="isLoading || isSaving">
    <p :id="saveStatusId" class="sr-only" aria-live="polite" aria-atomic="true">{{ saveStatusMessage }}</p>

    <EGText v-if="embedded" :id="headingId" tag="h2" class="sr-only">Workflow access</EGText>

    <EGPageHeader
      v-if="!embedded"
      :title-id="headingId"
      title="Workflow lab access"
      description="Grant labs access to HealthOmics workflows and Seqera pipelines for this organization. When “new workflows by default” is on, unlisted items stay allowed unless you turn them off (blocks new console workflows from being denied until you block them)."
      :back-action="() => $router.push(props.backPath)"
      :show-back="true"
      :is-loading="isLoading"
    />

    <div v-if="isLoading" class="text-text-muted py-10 text-center font-serif text-sm" role="status">
      Loading workflow access…
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
                <div class="text-text-body font-serif font-medium">Enable new workflows by default</div>
                <p :id="defaultWorkflowsHelpId" class="text-text-muted mt-1 max-w-xl text-xs">
                  When on, newly added HealthOmics or Seqera workflows are allowed for this lab until you turn them off
                  here. When off, only workflows you enable are allowed.
                </p>
              </div>
              <UToggle
                :model-value="pendingEnableNewByDefault[selectedLabId] === true"
                :aria-label="`Enable new workflows by default for ${selectedLab.Name}`"
                :aria-describedby="defaultWorkflowsHelpId"
                @update:model-value="setEnableNewWorkflowsForSelectedLab"
              />
            </div>
            <div class="overflow-x-auto">
              <h3 :id="workflowTableHeadingId" class="sr-only">Workflow access for {{ selectedLab.Name }}</h3>
              <table class="w-full min-w-[520px] text-left text-sm" :aria-labelledby="workflowTableHeadingId">
                <thead>
                  <tr class="border-background-dark-grey text-text-muted border-b text-xs font-semibold uppercase">
                    <th scope="col" class="pb-3 pr-4">Workflow</th>
                    <th scope="col" class="pb-3 pr-4">Type</th>
                    <th scope="col" class="pb-3">Access</th>
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
                        :aria-label="`${pendingKeys.has(accessKey(selectedLabId, row)) ? 'Revoke' : 'Grant'} access for ${row.name} (${row.platform}) in ${selectedLab.Name}`"
                        @update:model-value="(v: boolean) => setGranted(selectedLabId!, row, v)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="!catalog.length" class="text-text-muted text-sm" role="status">
              No workflows found. Enable Omics or Seqera on at least one lab and ensure workflows exist in the account.
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
