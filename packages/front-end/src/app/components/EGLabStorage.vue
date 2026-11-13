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
  type TypeTab = 'all' | LaboratoryStorageItemType;
  type AgeFilter = 'all' | 30 | 90;

  const typeTab = ref<TypeTab>('all');
  const ageFilter = ref<AgeFilter>('all');
  const searchQuery = ref('');

  const typeTabs = computed<{ key: TypeTab; label: string; count: number }[]>(() => {
    const count = (type: LaboratoryStorageItemType) => items.value.filter((item) => item.Type === type).length;
    return [
      { key: 'all', label: 'Everything', count: items.value.length },
      { key: 'RunOutputs', label: 'Run outputs', count: count('RunOutputs') },
      { key: 'InputData', label: 'Input data', count: count('InputData') },
      { key: 'SampleSheet', label: 'Sample sheets', count: count('SampleSheet') },
      { key: 'Unattached', label: 'No run record', count: count('Unattached') },
    ];
  });

  const ageFilters: { key: AgeFilter; label: string }[] = [
    { key: 'all', label: 'All ages' },
    { key: 30, label: 'Older than 30 days' },
    { key: 90, label: 'Older than 90 days' },
  ];

  const filteredItems = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const now = Date.now();
    return items.value.filter((item) => {
      if (typeTab.value !== 'all' && item.Type !== typeTab.value) return false;
      if (ageFilter.value !== 'all') {
        const modified = item.LastModified ? Date.parse(item.LastModified) : now;
        if (now - modified < ageFilter.value * DAY_MS) return false;
      }
      if (!query) return true;
      return [item.Name, item.Path, item.Detail, item.RunId].some((field) => field?.toLowerCase().includes(query));
    });
  });

  // ---- Row presentation ----
  const typeMeta: Record<LaboratoryStorageItemType, { label: string; icon: string }> = {
    RunOutputs: { label: 'Run outputs', icon: 'i-heroicons-folder' },
    InputData: { label: 'Input data', icon: 'i-heroicons-arrow-up-tray' },
    SampleSheet: { label: 'Sample sheet', icon: 'i-heroicons-document-text' },
    Unattached: { label: 'Unattached', icon: 'i-heroicons-exclamation-circle' },
  };

  type Protection = 'Protected' | 'Partial' | 'Unprotected';

  function protection(item: LaboratoryStorageItem): Protection {
    if (item.FileCount > 0 && item.ProtectedFileCount >= item.FileCount) return 'Protected';
    return item.ProtectedFileCount > 0 ? 'Partial' : 'Unprotected';
  }

  function statusChip(item: LaboratoryStorageItem): { label: string; class: string; note?: string } {
    if (item.Status === 'Running') return { label: 'Running', class: 'bg-primary-muted text-primary' };
    const state = protection(item);
    if (state === 'Protected') return { label: 'Protected', class: 'bg-background-light-grey text-body' };
    if (state === 'Partial') {
      return {
        label: 'Partly protected',
        class: 'bg-background-light-grey text-body',
        note: `${item.ProtectedFileCount} of ${item.FileCount} files`,
      };
    }
    switch (item.Status) {
      case 'Expiring':
        return {
          label: 'Scheduled for deletion',
          class: 'bg-alert-caution-muted text-alert-caution',
          note: 'Expected within 48 hours',
        };
      case 'RunFailed':
        return { label: 'Run failed', class: 'bg-alert-caution-muted text-alert-caution' };
      case 'NoRunRecord':
        return { label: 'No run record', class: 'bg-alert-danger-muted text-alert-danger' };
      default:
        return { label: 'Active', class: 'bg-alert-success-muted text-alert-success-text' };
    }
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

  async function protectSelected() {
    await storageStore.setLabStorageProtection(props.orgId, props.labId, [...selectedIds.value], true);
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
  const noRunRecordSavingLine = computed(() => {
    const totals = summary.value;
    if (!totals?.PricePerGbMonthUsd) return '';
    return (
      `Roughly ${monthlyUsd(totals.TotalBytes)} a month at S3 standard pricing. ` +
      `Clearing everything without a run record would take that to ${monthlyUsd(totals.TotalBytes - totals.NoRunRecordBytes)}.`
    );
  });

  // ---- Retention ----
  const retentionMonths = ref<number>(6);
  const includePrePolicyData = ref(true);
  const keepInputData = ref(false);

  function resetRetentionForm() {
    retentionMonths.value = lab.value?.RunRetentionMonths ?? 6;
    // Undefined means on: the orphan cleanup ran for every lab before this setting existed.
    includePrePolicyData.value = lab.value?.RetentionIncludePrePolicyData !== false;
    keepInputData.value = lab.value?.RetentionKeepInputData === true;
  }
  watch(lab, resetRetentionForm, { immediate: true });

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
  }

  const columns = [
    { key: 'select', label: '', class: 'w-10', rowClass: 'w-10' },
    { key: 'Name', label: 'Item' },
    { key: 'Type', label: 'Type' },
    { key: 'FileCount', label: 'Files', class: 'w-20', rowClass: 'w-20' },
    { key: 'SizeBytes', label: 'Size', class: 'w-24', rowClass: 'w-24' },
    { key: 'LastModified', label: 'Last modified', class: 'w-32', rowClass: 'w-32' },
    { key: 'Status', label: 'Status', class: 'w-48', rowClass: 'w-48' },
    { key: 'actions', label: 'Actions', class: 'w-24', rowClass: 'w-24' },
  ];
</script>

<template>
  <div class="space-y-4">
    <span
      class="bg-background-dark-grey text-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
    >
      <UIcon name="i-heroicons-lock-closed" class="h-3.5 w-3.5" aria-hidden="true" />
      Lab managers and above
    </span>

    <div
      v-if="!lab?.S3Bucket"
      class="border-stroke-light text-muted rounded-2xl border bg-white p-6 text-sm"
      role="status"
    >
      This lab has no default S3 bucket yet. An organization admin can set one in Lab settings.
    </div>

    <template v-else>
      <!-- Stats -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="border-stroke-light rounded-2xl border bg-white p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(summary?.TotalBytes ?? 0) }}</p>
          <p class="text-muted text-xs">Total stored in this lab</p>
        </div>
        <div class="border-stroke-light rounded-2xl border bg-white p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(summary?.AttachedBytes ?? 0) }}</p>
          <p class="text-muted text-xs">Attached to a run</p>
        </div>
        <div class="border-alert-caution bg-alert-caution-muted rounded-2xl border p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-alert-caution text-2xl font-semibold">
            {{ compactSize(summary?.NoRunRecordBytes ?? 0) }}
          </p>
          <p class="text-muted text-xs">
            {{ (summary?.NoRunRecordFileCount ?? 0).toLocaleString() }} files with no run record
          </p>
        </div>
        <div class="border-stroke-light rounded-2xl border bg-white p-4">
          <USkeleton v-if="isLoading" class="h-8 w-24" />
          <p v-else class="text-heading text-2xl font-semibold">{{ summary?.ProtectedItemCount ?? 0 }}</p>
          <p class="text-muted text-xs">Protected from deletion</p>
        </div>
      </div>

      <p class="text-muted text-xs">
        {{ noRunRecordSavingLine }}
        <span v-if="summary?.ScannedAt">Scanned {{ formatRelativeDateTime(summary.ScannedAt) }}.</span>
      </p>

      <!-- Type tabs -->
      <div role="tablist" aria-label="Filter by type" class="border-stroke-light flex gap-6 border-b">
        <button
          v-for="tab in typeTabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="typeTab === tab.key"
          class="-mb-px flex items-center gap-2 border-b-2 pb-2 text-sm"
          :class="typeTab === tab.key ? 'border-primary text-heading font-semibold' : 'text-muted border-transparent'"
          @click="typeTab = tab.key"
        >
          {{ tab.label }}
          <span class="bg-background-light-grey rounded-full px-2 text-xs">{{ tab.count }}</span>
        </button>
      </div>

      <!-- Search + age -->
      <div class="flex flex-wrap items-center gap-3">
        <EGSearchInput
          class="w-full max-w-sm"
          label="Search runs, samples or paths"
          placeholder="Search runs, samples or paths"
          @input-event="searchQuery = $event"
        />
        <div role="group" aria-label="Filter by age" class="flex flex-wrap gap-2">
          <button
            v-for="filter in ageFilters"
            :key="String(filter.key)"
            type="button"
            :aria-pressed="ageFilter === filter.key"
            class="rounded-full border px-4 py-3 text-sm leading-none"
            :class="
              ageFilter === filter.key
                ? 'border-primary bg-primary-muted text-primary'
                : 'border-stroke-light text-body bg-white'
            "
            @click="ageFilter = filter.key"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>

      <!-- Bulk actions -->
      <div
        v-if="selectedIds.size > 0"
        class="bg-primary-muted flex items-center justify-between rounded-2xl px-4 py-2 text-sm"
        role="region"
        aria-label="Selected items"
      >
        <span>{{ selectedIds.size }} selected · {{ compactSize(selectedBytes) }}</span>
        <div class="flex gap-2">
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            :variant="ButtonVariantEnum.enum.secondary"
            label="Protect"
            icon="i-heroicons-lock-closed"
            :disabled="isMutating"
            @click="protectSelected"
          />
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            :variant="ButtonVariantEnum.enum.destructive"
            label="Delete"
            icon="i-heroicons-trash"
            :disabled="isMutating"
            @click="confirmDelete([...selectedIds])"
          />
        </div>
      </div>

      <div class="lab-storage-table">
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
            <div class="flex min-w-0 items-start gap-2">
              <span
                class="bg-background-light-grey text-muted inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              >
                <UIcon :name="typeMeta[row.Type as LaboratoryStorageItemType].icon" class="h-4 w-4" />
              </span>
              <div class="min-w-0">
                <p class="text-heading truncate text-sm font-semibold">{{ row.Name }}</p>
                <p class="text-muted/70 mt-0.5 truncate font-mono text-xs">{{ row.Path }}</p>
              </div>
            </div>
          </template>
          <template #Type-data="{ row }">
            <p class="text-body text-sm">{{ typeMeta[row.Type as LaboratoryStorageItemType].label }}</p>
            <p class="text-muted text-xs">{{ row.Detail }}</p>
          </template>
          <template #FileCount-data="{ row }">
            <span class="text-body text-sm">{{ row.FileCount.toLocaleString() }}</span>
          </template>
          <template #SizeBytes-data="{ row }">
            <span class="text-heading text-sm font-semibold">{{ compactSize(row.SizeBytes) }}</span>
          </template>
          <template #LastModified-data="{ row }">
            <span class="text-body text-sm">{{ formatRelativeDateTime(row.LastModified) ?? '—' }}</span>
          </template>
          <template #Status-data="{ row }">
            <span
              class="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase"
              :class="statusChip(row).class"
            >
              {{ statusChip(row).label }}
            </span>
            <p v-if="statusChip(row).note" class="text-muted mt-1 text-xs">{{ statusChip(row).note }}</p>
          </template>
          <template #actions-data="{ row }">
            <div class="flex gap-2">
              <UButton
                :icon="protection(row) === 'Unprotected' ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
                size="xs"
                :color="protection(row) === 'Protected' ? 'primary' : 'gray'"
                :variant="protection(row) === 'Unprotected' ? 'outline' : 'soft'"
                :disabled="row.FileCount === 0 || isMutating"
                :aria-label="protection(row) === 'Protected' ? `Unprotect ${row.Name}` : `Protect ${row.Name}`"
                :title="protection(row) === 'Protected' ? 'Allow deletion' : 'Protect from deletion'"
                :ui="{ rounded: 'rounded-full' }"
                @click="toggleProtection(row)"
              />
              <UButton
                icon="i-heroicons-trash"
                size="xs"
                color="gray"
                variant="outline"
                :disabled="!!deleteBlockedReason(row) || isMutating"
                :aria-label="`Delete ${row.Name}`"
                :title="deleteBlockedReason(row) ?? 'Delete'"
                :ui="{ rounded: 'rounded-full' }"
                @click="confirmDelete([row.ItemId])"
              />
            </div>
          </template>
        </EGTable>
      </div>
    </template>

    <!-- Automatic retention -->
    <section
      aria-labelledby="lab-storage-retention-heading"
      class="border-stroke-light rounded-2xl border bg-white"
    >
      <div class="border-stroke-light flex items-center justify-between border-b px-4 py-3">
        <h2 id="lab-storage-retention-heading" class="text-heading text-sm font-semibold">Automatic retention</h2>
        <span class="text-muted text-xs">Moved here from Lab Settings</span>
      </div>
      <div class="grid gap-6 p-4 md:grid-cols-3">
        <EGFormGroup label="Run retention (months)" name="RunRetentionMonths" :error="retentionError">
          <EGInput
            v-model.number="retentionMonths"
            type="number"
            min="0"
            max="120"
            step="1"
            :disabled="!canEditRetention || isSavingRetention"
            aria-describedby="lab-storage-retention-help"
          />
          <p id="lab-storage-retention-help" class="text-muted mt-1 text-xs">
            0 = never delete run records. Applies to outputs and sample sheets. Protected runs are always skipped.
          </p>
        </EGFormGroup>
        <div>
          <UCheckbox
            v-model="includePrePolicyData"
            :disabled="!canEditRetention || isSavingRetention"
            label="Apply to data created before this policy"
            aria-describedby="lab-storage-pre-policy-help"
          />
          <p id="lab-storage-pre-policy-help" class="text-muted mt-1 pl-6 text-xs">
            Without it, anything already in the bucket when the policy was set stays forever, which is how unattached
            data builds up.
          </p>
        </div>
        <div>
          <UCheckbox
            v-model="keepInputData"
            :disabled="!canEditRetention || isSavingRetention"
            label="Keep input data"
            aria-describedby="lab-storage-keep-input-help"
          />
          <p id="lab-storage-keep-input-help" class="text-muted mt-1 pl-6 text-xs">
            Retention clears outputs and sample sheets only. Sequencing reads stay until deleted from the list above.
          </p>
        </div>
      </div>
      <p v-if="!canEditRetention" class="text-muted px-4 pb-4 text-xs">
        Only an organization admin can change this lab's retention.
      </p>
    </section>

    <div v-if="canEditRetention" class="flex gap-2">
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        label="Save Changes"
        :disabled="!retentionDirty || !!retentionError || isSavingRetention || isLoadingRetentionPreview"
        :loading="isSavingRetention || isLoadingRetentionPreview"
        @click="handleSaveRetention"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        label="Cancel"
        :disabled="!retentionDirty || isSavingRetention"
        @click="resetRetentionForm"
      />
    </div>

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
