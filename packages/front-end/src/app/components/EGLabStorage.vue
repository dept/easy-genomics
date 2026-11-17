<script setup lang="ts">
  import type {
    LaboratoryStorageItem,
    LaboratoryStorageItemType,
  } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { RunRetentionMonthsSchema } from '@FE/types/labs';
  import { formatRelativeDateTime } from '@FE/utils/date-time';
  import { formatFileSize } from '@FE/utils/file-size';

  const props = defineProps<{
    orgId: string;
    labId: string;
  }>();

  const storageStore = useStorageStore();
  const labsStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BYTES_PER_GB = 1024 ** 3;

  const lab = computed(() => labsStore.labs[props.labId]);
  const summary = computed(() => storageStore.labStorage[props.labId]);
  const items = computed<LaboratoryStorageItem[]>(() => summary.value?.Items ?? []);
  const isLoading = computed(() => uiStore.isRequestPending('loadLabStorage') && !summary.value);
  const isMutating = computed(
    () => uiStore.isRequestPending('editLabStorage') || uiStore.isRequestPending('rescanLabStorage'),
  );
  // update-laboratory is org-admin only, so lab managers see the policy read-only.
  const canEditRetention = computed(() => userStore.canEditLabDetails());

  onMounted(() => {
    if (lab.value?.S3Bucket) void storageStore.loadLabStorage(props.orgId, props.labId);
  });

  /** "8.40 GB" → "8.4 GB", "329.00 GB" → "329 GB". */
  function compactSize(bytes: number): string {
    const [value, unit] = formatFileSize(bytes).split(' ');
    return `${parseFloat(value)} ${unit}`;
  }

  function monthlyUsd(bytes: number): string {
    const price = summary.value?.PricePerGbMonthUsd ?? 0;
    return `US$${((bytes / BYTES_PER_GB) * price).toFixed(2)}`;
  }

  // ---- Filters ----
  type TypeFilter = 'all' | LaboratoryStorageItemType;
  type AgeFilter = 'all' | '30' | '90';

  const typeFilter = ref<TypeFilter>('all');
  const ageFilter = ref<AgeFilter>('all');
  const searchQuery = ref('');

  const typeFilterOptions: { label: string; value: TypeFilter }[] = [
    { label: 'All types', value: 'all' },
    { label: 'Run outputs', value: 'RunOutputs' },
    { label: 'Input data', value: 'InputData' },
    { label: 'Sample sheets', value: 'SampleSheet' },
    { label: 'Not linked to a run', value: 'Unattached' },
  ];

  const ageFilterOptions: { label: string; value: AgeFilter }[] = [
    { label: 'Any age', value: 'all' },
    { label: 'Older than 30 days', value: '30' },
    { label: 'Older than 90 days', value: '90' },
  ];

  // Match EGSearchInput height (px-5 py-4).
  const filterSelectUi = { padding: { sm: 'px-5 py-4' } };

  const filteredItems = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const now = Date.now();
    const minAgeDays = ageFilter.value === 'all' ? 0 : Number(ageFilter.value);
    return items.value.filter((item) => {
      if (typeFilter.value !== 'all' && item.Type !== typeFilter.value) return false;
      if (minAgeDays > 0) {
        const modified = item.LastModified ? Date.parse(item.LastModified) : now;
        if (now - modified < minAgeDays * DAY_MS) return false;
      }
      if (!query) return true;
      return [item.Name, item.Path, item.Detail, item.RunId].some((field) => field?.toLowerCase().includes(query));
    });
  });

  // ---- Row presentation ----
  const typeLabels: Record<LaboratoryStorageItemType, string> = {
    RunOutputs: 'Run outputs',
    InputData: 'Input data',
    SampleSheet: 'Sample sheets',
    Unattached: 'Not linked to a run',
  };

  type Protection = 'Protected' | 'Partial' | 'Unprotected';

  function protection(item: LaboratoryStorageItem): Protection {
    if (item.FileCount > 0 && item.ProtectedFileCount >= item.FileCount) return 'Protected';
    return item.ProtectedFileCount > 0 ? 'Partial' : 'Unprotected';
  }

  /** "Run outputs · TheiaCoV_Illumina_PE · 412 files" / "Outside any run folder · 1 file" */
  function itemSubtitle(item: LaboratoryStorageItem): string {
    const files = `${item.FileCount.toLocaleString()} file${item.FileCount === 1 ? '' : 's'}`;
    if (item.Type === 'Unattached') {
      return item.Detail ? `${item.Detail} · ${files}` : files;
    }
    const parts = [typeLabels[item.Type]];
    if (item.Detail) parts.push(item.Detail);
    parts.push(files);
    return parts.join(' · ');
  }

  /** Flagged statuses only — Active / success stay blank. */
  function statusFlag(item: LaboratoryStorageItem): { label: string; dotClass: string } | null {
    const state = protection(item);
    if (state === 'Protected') return { label: 'Protected', dotClass: 'bg-primary' };
    if (state === 'Partial') return { label: 'Partly protected', dotClass: 'bg-primary' };
    if (item.Type === 'Unattached' || item.Status === 'NoRunRecord') {
      return { label: 'Not linked to a run', dotClass: 'bg-alert-caution' };
    }
    if (item.Status === 'Expiring') return { label: 'Scheduled for deletion', dotClass: 'bg-alert-caution' };
    if (item.Status === 'RunFailed') return { label: 'Run failed', dotClass: 'bg-alert-caution' };
    if (item.Status === 'Running') return { label: 'Running', dotClass: 'bg-primary' };
    return null;
  }

  function rowActionItems(item: LaboratoryStorageItem) {
    const protectLabel = protection(item) === 'Unprotected' ? 'Protect from deletion' : 'Allow deletion';
    return [
      [
        {
          label: protectLabel,
          click: () => toggleProtection(item),
          disabled: item.FileCount === 0 || isMutating.value,
        },
      ],
      [
        {
          label: 'Delete',
          click: () => confirmDelete([item.ItemId]),
          isHighlighted: true,
          disabled: !!deleteBlockedReason(item) || isMutating.value,
        },
      ],
    ];
  }

  function deleteBlockedReason(item: LaboratoryStorageItem): string | null {
    if (item.Status === 'Running') return 'This run is still running';
    if (protection(item) === 'Protected') return 'Protected from deletion';
    if (!item.Deletable) {
      return item.Type === 'Unattached'
        ? 'Changed in the last 30 days, so an upload may still be using it'
        : 'This data cannot be deleted from here';
    }
    return null;
  }

  // ---- Selection ----
  const selectedIds = ref<Set<string>>(new Set());

  const selectableVisibleItems = computed(() => filteredItems.value.filter((item) => !deleteBlockedReason(item)));
  const selectedItems = computed(() => items.value.filter((item) => selectedIds.value.has(item.ItemId)));
  const selectedBytes = computed(() => selectedItems.value.reduce((sum, item) => sum + item.SizeBytes, 0));
  const allVisibleSelected = computed(
    () =>
      selectableVisibleItems.value.length > 0 &&
      selectableVisibleItems.value.every((item) => selectedIds.value.has(item.ItemId)),
  );

  function toggleSelected(itemId: string, checked: boolean) {
    const next = new Set(selectedIds.value);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    selectedIds.value = next;
  }

  function toggleAllVisible(checked: boolean) {
    const next = new Set(selectedIds.value);
    for (const item of selectableVisibleItems.value) {
      if (checked) next.add(item.ItemId);
      else next.delete(item.ItemId);
    }
    selectedIds.value = next;
  }

  // Drop selections that a rescan, delete or protect made unselectable or removed.
  watch(items, () => {
    const stillSelectable = new Set(items.value.filter((item) => !deleteBlockedReason(item)).map((i) => i.ItemId));
    selectedIds.value = new Set([...selectedIds.value].filter((id) => stillSelectable.has(id)));
  });

  // ---- Actions ----
  async function toggleProtection(item: LaboratoryStorageItem) {
    await storageStore.setLabStorageProtection(
      props.orgId,
      props.labId,
      [item.ItemId],
      protection(item) !== 'Protected',
    );
  }

  const pendingDeleteIds = ref<string[]>([]);
  const isDeleteDialogOpen = ref(false);
  const pendingDeleteItems = computed(() => items.value.filter((item) => pendingDeleteIds.value.includes(item.ItemId)));
  const deleteDialogMessage = computed(() => {
    const files = pendingDeleteItems.value.reduce((sum, item) => sum + item.FileCount, 0);
    const bytes = pendingDeleteItems.value.reduce((sum, item) => sum + item.SizeBytes, 0);
    return (
      `This permanently deletes up to ${files.toLocaleString()} file${files === 1 ? '' : 's'} (${compactSize(bytes)}) ` +
      "from this lab's S3 bucket. This cannot be undone.\n\n" +
      'Protected files, files another run still uses and files linked to Data Collections samples are kept. ' +
      'Run records stay in the runs list.'
    );
  });

  function confirmDelete(itemIds: string[]) {
    pendingDeleteIds.value = itemIds;
    isDeleteDialogOpen.value = true;
  }

  async function handleDeleteConfirmed() {
    await storageStore.removeLabStorageItems(props.orgId, props.labId, pendingDeleteIds.value);
    isDeleteDialogOpen.value = false;
    pendingDeleteIds.value = [];
  }

  // ---- Stats ----
  const protectedRunCount = computed(() => summary.value?.ProtectedItemCount ?? 0);
  const protectedRunLabel = computed(() => {
    const count = protectedRunCount.value;
    return `${count.toLocaleString()} run${count === 1 ? '' : 's'}`;
  });
  const retentionMonthsLabel = computed(() => {
    const months = lab.value?.RunRetentionMonths ?? 6;
    if (months === 0) return 'Never';
    return `${months} month${months === 1 ? '' : 's'}`;
  });
  const monthlyCostSubtitle = computed(() => {
    const totals = summary.value;
    if (!totals) return 'Stored';
    if (!totals.PricePerGbMonthUsd) return 'Stored';
    return `Stored · about ${monthlyUsd(totals.TotalBytes)} a month`;
  });

  function reviewUnattached() {
    typeFilter.value = 'Unattached';
  }

  // ---- Retention ----
  const isRetentionEditorOpen = ref(false);
  const retentionMonths = ref<number>(6);
  const includePrePolicyData = ref(true);
  const keepInputData = ref(false);
  const retentionMonthOptions = computed(() => {
    const presets = [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 120];
    const current = lab.value?.RunRetentionMonths ?? 6;
    const months = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
    return months.map((value) => ({
      label: value === 0 ? 'Never' : `${value} month${value === 1 ? '' : 's'}`,
      value,
    }));
  });

  function resetRetentionForm() {
    retentionMonths.value = lab.value?.RunRetentionMonths ?? 6;
    // Undefined means on: the orphan cleanup ran for every lab before this setting existed.
    includePrePolicyData.value = lab.value?.RetentionIncludePrePolicyData !== false;
    keepInputData.value = lab.value?.RetentionKeepInputData === true;
  }
  watch(lab, resetRetentionForm, { immediate: true });

  function openRetentionEditor() {
    resetRetentionForm();
    isRetentionEditorOpen.value = true;
  }

  function closeRetentionEditor() {
    resetRetentionForm();
    isRetentionEditorOpen.value = false;
  }

  const retentionError = computed(() => {
    const result = RunRetentionMonthsSchema.safeParse(retentionMonths.value);
    return result.success ? '' : result.error.issues[0]?.message;
  });
  const retentionDirty = computed(
    () =>
      retentionMonths.value !== (lab.value?.RunRetentionMonths ?? 6) ||
      includePrePolicyData.value !== (lab.value?.RetentionIncludePrePolicyData !== false) ||
      keepInputData.value !== (lab.value?.RetentionKeepInputData === true),
  );
  const isSavingRetention = computed(() => uiStore.isRequestPending('updateLab'));
  const isLoadingRetentionPreview = ref(false);
  const isRetentionWarningOpen = ref(false);
  const isRetentionConfirmOpen = ref(false);
  const retentionPreview = ref<{ immediate: number; updated: number } | null>(null);

  const retentionWarningMessage = computed(() => {
    const months = retentionMonths.value;
    const policy = months === 0 ? 'never delete run records' : `${months} month${months === 1 ? '' : 's'}`;
    const counts = retentionPreview.value;
    const line = `New run retention policy after save: ${policy}.`;
    if (!counts) return line;
    return `${line}\n\n${counts.immediate} run${counts.immediate === 1 ? '' : 's'} will be deleted immediately (new expiry is in the past).\n${counts.updated} run${counts.updated === 1 ? '' : 's'} will have their expiration date updated.`;
  });

  async function handleSaveRetention() {
    if (retentionError.value) return;
    if (retentionMonths.value === (lab.value?.RunRetentionMonths ?? 6)) {
      await saveRetention();
      return;
    }
    isLoadingRetentionPreview.value = true;
    retentionPreview.value = await labsStore.previewRunRetention(props.labId, retentionMonths.value);
    isLoadingRetentionPreview.value = false;
    if (retentionPreview.value) isRetentionWarningOpen.value = true;
  }

  function handleRetentionWarningConfirmed() {
    isRetentionWarningOpen.value = false;
    // "Never delete" only clears expiry; skip the irreversible-deletion confirmation.
    if (retentionMonths.value === 0) {
      void saveRetention();
      return;
    }
    isRetentionConfirmOpen.value = true;
  }

  async function saveRetention() {
    await labsStore.updateRetention(props.labId, {
      RunRetentionMonths: retentionMonths.value,
      RetentionIncludePrePolicyData: includePrePolicyData.value,
      RetentionKeepInputData: keepInputData.value,
    });
    isRetentionConfirmOpen.value = false;
    isRetentionEditorOpen.value = false;
  }

  const columns = [
    { key: 'select', label: '', class: 'w-10', rowClass: 'w-10' },
    { key: 'Name', label: 'Item' },
    { key: 'SizeBytes', label: 'Size', class: 'w-28', rowClass: 'w-28' },
    { key: 'LastModified', label: 'Last modified', class: 'w-36', rowClass: 'w-36' },
    { key: 'Status', label: 'Status', class: 'w-48', rowClass: 'w-48' },
    { key: 'actions', label: '', class: 'w-14', rowClass: 'w-14' },
  ];
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="!lab?.S3Bucket"
      class="border-stroke-light text-muted rounded-2xl border bg-white p-6 text-sm"
      role="status"
    >
      This lab has no default S3 bucket yet. An organization admin can set one in Lab settings.
    </div>

    <template v-else>
      <!-- Stats -->
      <div
        class="border-stroke-light divide-stroke-light grid grid-cols-2 divide-y overflow-hidden rounded-2xl border bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0"
        role="group"
        aria-label="Lab storage summary"
      >
        <div class="p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(summary?.TotalBytes ?? 0) }}</p>
          <p class="text-muted mt-1 text-xs">{{ monthlyCostSubtitle }}</p>
        </div>
        <div class="p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">
            {{ compactSize(summary?.NoRunRecordBytes ?? 0) }}
          </p>
          <p class="text-muted mt-1 text-xs">
            Not linked to a run · {{ (summary?.NoRunRecordFileCount ?? 0).toLocaleString() }} files
          </p>
          <button
            type="button"
            class="text-primary mt-2 text-sm font-medium hover:underline"
            @click="reviewUnattached"
          >
            Review
          </button>
        </div>
        <div class="p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ protectedRunLabel }}</p>
          <p class="text-muted mt-1 text-xs">Protected from deletion</p>
        </div>
        <div class="p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ retentionMonthsLabel }}</p>
          <p class="text-muted mt-1 text-xs">Automatic retention</p>
          <button
            v-if="canEditRetention"
            type="button"
            class="text-primary mt-2 text-sm font-medium hover:underline"
            @click="isRetentionEditorOpen ? closeRetentionEditor() : openRetentionEditor()"
          >
            {{ isRetentionEditorOpen ? 'Close' : 'Edit' }}
          </button>
          <p v-else class="text-muted mt-2 text-xs">Only an organization admin can change this.</p>
        </div>
      </div>

      <!-- Retention editor (opened from Edit on the retention pill) -->
      <section
        v-if="isRetentionEditorOpen && canEditRetention"
        aria-labelledby="lab-storage-retention-heading"
        class="border-stroke-light rounded-2xl border bg-white p-4"
      >
        <h2 id="lab-storage-retention-heading" class="sr-only">Edit automatic retention</h2>
        <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
          <EGFormGroup
            label="Clear run outputs and sample sheets after"
            name="RunRetentionMonths"
            :error="retentionError"
          >
            <USelect
              :model-value="retentionMonths"
              :options="retentionMonthOptions"
              :disabled="isSavingRetention"
              aria-describedby="lab-storage-retention-help"
              @update:model-value="retentionMonths = Number($event)"
            />
            <p id="lab-storage-retention-help" class="text-muted mt-1 text-xs">
              Counted from when the run finished. Protected runs are always skipped.
            </p>
          </EGFormGroup>
          <div class="space-y-3 md:pt-8">
            <UCheckbox
              v-model="includePrePolicyData"
              :disabled="isSavingRetention"
              label="Also apply to data from before this policy"
            />
            <UCheckbox
              v-model="keepInputData"
              :disabled="isSavingRetention"
              label="Keep input data (sequencing reads)"
            />
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            :variant="ButtonVariantEnum.enum.secondary"
            label="Cancel"
            :disabled="isSavingRetention"
            @click="closeRetentionEditor"
          />
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            label="Save"
            :disabled="!retentionDirty || !!retentionError || isSavingRetention || isLoadingRetentionPreview"
            :loading="isSavingRetention || isLoadingRetentionPreview"
            @click="handleSaveRetention"
          />
        </div>
      </section>

      <!-- Search + filters -->
      <div class="flex flex-wrap items-center gap-3">
        <EGSearchInput
          class="w-full max-w-sm"
          label="Search runs, samples or paths"
          placeholder="Search runs, samples or paths"
          @input-event="searchQuery = $event"
        />
        <USelect
          :model-value="typeFilter"
          :options="typeFilterOptions"
          class="w-48"
          aria-label="Filter by type"
          :ui="filterSelectUi"
          @update:model-value="typeFilter = $event"
        />
        <USelect
          :model-value="ageFilter"
          :options="ageFilterOptions"
          class="w-52"
          aria-label="Filter by age"
          :ui="filterSelectUi"
          @update:model-value="ageFilter = $event"
        />
      </div>

      <div class="lab-storage-table border-stroke-light overflow-hidden rounded-2xl border bg-white">
        <div
          v-if="selectedIds.size > 0"
          class="bg-primary-muted flex items-center justify-between px-4 py-3"
          role="region"
          aria-label="Selected items"
        >
          <span class="text-heading text-sm font-semibold">
            {{ selectedIds.size }} selected · {{ compactSize(selectedBytes) }}
          </span>
          <div class="flex gap-2">
            <EGButton
              :size="ButtonSizeEnum.enum.sm"
              :variant="ButtonVariantEnum.enum.secondary"
              label="Clear"
              :disabled="isMutating"
              @click="selectedIds = new Set()"
            />
            <EGButton
              :size="ButtonSizeEnum.enum.sm"
              :variant="ButtonVariantEnum.enum.destructive"
              label="Delete"
              :disabled="isMutating"
              @click="confirmDelete([...selectedIds])"
            />
          </div>
        </div>
        <EGTable :table-data="filteredItems" :columns="columns" :is-loading="isLoading" :show-pagination="!isLoading">
          <template #select-header>
            <UCheckbox
              :model-value="allVisibleSelected"
              :disabled="selectableVisibleItems.length === 0 || isMutating"
              label="Select all deletable items"
              :ui="{ label: 'sr-only' }"
              @update:model-value="toggleAllVisible"
            />
          </template>
          <template #select-data="{ row }">
            <UCheckbox
              :model-value="selectedIds.has(row.ItemId)"
              :disabled="!!deleteBlockedReason(row) || isMutating"
              :title="deleteBlockedReason(row) ?? undefined"
              :label="`Select ${row.Name}`"
              :ui="{ label: 'sr-only' }"
              @update:model-value="toggleSelected(row.ItemId, $event)"
            />
          </template>
          <template #Name-data="{ row }">
            <div class="min-w-0">
              <p class="text-heading truncate text-sm font-semibold">{{ row.Name }}</p>
              <p class="text-muted mt-0.5 truncate text-xs">{{ itemSubtitle(row) }}</p>
            </div>
          </template>
          <template #SizeBytes-data="{ row }">
            <span class="text-body text-sm">{{ compactSize(row.SizeBytes) }}</span>
          </template>
          <template #LastModified-data="{ row }">
            <span class="text-body text-sm">{{ formatRelativeDateTime(row.LastModified) ?? '—' }}</span>
          </template>
          <template #Status-data="{ row }">
            <span
              v-if="statusFlag(row)"
              class="text-body inline-flex items-center gap-2 text-sm"
            >
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="statusFlag(row)?.dotClass"
                aria-hidden="true"
              />
              {{ statusFlag(row)?.label }}
            </span>
          </template>
          <template #actions-data="{ row }">
            <div class="flex justify-end" @click.stop>
              <EGActionButton :menu-label="`Actions for ${row.Name}`" :items="rowActionItems(row)" />
            </div>
          </template>
        </EGTable>
      </div>
    </template>

    <EGDialog
      v-model="isDeleteDialogOpen"
      :primary-message="`Delete ${pendingDeleteIds.length} item${pendingDeleteIds.length === 1 ? '' : 's'}?`"
      :secondary-message="deleteDialogMessage"
      action-label="Delete permanently"
      :action-variant="ButtonVariantEnum.enum.destructive"
      cancel-label="Cancel"
      :cancel-variant="ButtonVariantEnum.enum.secondary"
      :loading="uiStore.isRequestPending('editLabStorage')"
      :buttons-disabled="uiStore.isRequestPending('editLabStorage')"
      @action-triggered="handleDeleteConfirmed"
    />

    <EGDialog
      v-model="isRetentionWarningOpen"
      primary-message="Warning: Data Loss Risk"
      :secondary-message="retentionWarningMessage"
      action-label="Save Changes"
      :action-variant="ButtonVariantEnum.enum.primary"
      cancel-label="Cancel"
      :cancel-variant="ButtonVariantEnum.enum.secondary"
      :loading="isSavingRetention"
      :buttons-disabled="isSavingRetention"
      @action-triggered="handleRetentionWarningConfirmed"
    />

    <EGDialog
      v-model="isRetentionConfirmOpen"
      primary-message="Are you sure?"
      secondary-message="This cannot be undone. Data scheduled for deletion under the new retention policy can take up to 48 hours to be permanently removed from the system."
      action-label="Confirm"
      :action-variant="ButtonVariantEnum.enum.primary"
      cancel-label="Cancel"
      :cancel-variant="ButtonVariantEnum.enum.secondary"
      :loading="isSavingRetention"
      :buttons-disabled="isSavingRetention"
      @action-triggered="saveRetention"
    />
  </div>
</template>

<style scoped lang="scss">
  /* Selection bar + table share one rounded card; flatten EGTable's own card chrome. */
  .lab-storage-table :deep(> .rounded-2xl) {
    border-radius: 0;
    box-shadow: none;
  }

  /* EGTable assumes the first column is the wide name column; here the checkbox is first. */
  .lab-storage-table :deep(table) {
    thead tr th:first-child,
    tbody tr td:first-child {
      width: 48px;
      min-width: 48px;
      max-width: 48px;
      padding-left: 16px;
      padding-right: 0;
    }

    thead tr th:nth-child(2),
    tbody tr td:nth-child(2) {
      width: auto;
      min-width: 180px;
      padding-left: 12px;
    }
  }
</style>
