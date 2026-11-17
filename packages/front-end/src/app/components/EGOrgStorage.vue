<script setup lang="ts">
  import type { OrganizationStorageLab } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
  import { formatFileSize } from '@FE/utils/file-size';
  import {
    nextOrgStorageSort,
    orgStorageLabLocation,
    sortOrgStorageLabs,
    type OrgStorageSort,
    type OrgStorageSortColumn,
  } from '@FE/utils/org-storage-table';

  const props = defineProps<{
    orgId: string;
    superuser?: boolean;
  }>();

  const storageStore = useStorageStore();
  const uiStore = useUiStore();
  const router = useRouter();

  const BYTES_PER_GB = 1024 ** 3;

  const labs = computed<OrganizationStorageLab[]>(() => storageStore.orgStorage[props.orgId] ?? []);
  const isLoading = computed(() => uiStore.isRequestPending('loadOrgStorage') && labs.value.length === 0);

  const SORTABLE_COLUMNS: OrgStorageSortColumn[] = ['Name', 'Stored', 'NotLinked'];
  const tableSort = ref<OrgStorageSort>({ column: 'Stored', direction: 'desc' });
  const sortedLabs = computed(() => sortOrgStorageLabs(labs.value, tableSort.value));

  function sortIcon(column: OrgStorageSortColumn): string {
    if (tableSort.value.column !== column) return 'i-heroicons-arrows-up-down-20-solid';
    return tableSort.value.direction === 'asc'
      ? 'i-heroicons-bars-arrow-up-20-solid'
      : 'i-heroicons-bars-arrow-down-20-solid';
  }

  onMounted(() => {
    void storageStore.loadOrgStorage(props.orgId);
  });

  /** "8.40 GB" → "8.4 GB", "329.00 GB" → "329 GB". */
  function compactSize(bytes: number): string {
    const [value, unit] = formatFileSize(bytes).split(' ');
    return `${parseFloat(value)} ${unit}`;
  }

  const totals = computed(() => {
    let totalBytes = 0;
    let noRunRecordBytes = 0;
    let estimatedMonthlyUsd = 0;
    let labsWithNoRetention = 0;
    let labsWithStorage = 0;

    for (const lab of labs.value) {
      // undefined inherits the back-end 6-month default; only explicit 0 means never delete.
      if (lab.RunRetentionMonths === 0) labsWithNoRetention += 1;
      const storage = lab.Storage;
      if (!storage) continue;
      labsWithStorage += 1;
      totalBytes += storage.TotalBytes;
      noRunRecordBytes += storage.NoRunRecordBytes;
      if (storage.PricePerGbMonthUsd) {
        estimatedMonthlyUsd += (storage.TotalBytes / BYTES_PER_GB) * storage.PricePerGbMonthUsd;
      }
    }

    return { totalBytes, noRunRecordBytes, estimatedMonthlyUsd, labsWithNoRetention, labsWithStorage };
  });

  const savingLine = computed(() => {
    const priced = labs.value
      .map((lab) => lab.Storage)
      .filter((storage): storage is NonNullable<typeof storage> => !!storage?.PricePerGbMonthUsd);
    if (priced.length === 0) return '';

    let noRunRecordCost = 0;
    for (const storage of priced) {
      noRunRecordCost += (storage.NoRunRecordBytes / BYTES_PER_GB) * (storage.PricePerGbMonthUsd ?? 0);
    }
    return `At S3 standard pricing. Clearing everything without a run record across all labs would save about US$${Math.round(noRunRecordCost)} a month.`;
  });

  function retentionLabel(months: number | undefined): string {
    if (months === 0) return 'Never';
    // undefined inherits the back-end 6-month default.
    const effective = months ?? 6;
    return `${effective} month${effective === 1 ? '' : 's'}`;
  }

  function noRunRecordCell(lab: OrganizationStorageLab): string {
    const storage = lab.Storage;
    if (!storage || storage.NoRunRecordBytes <= 0) return 'None';
    const pct = storage.TotalBytes > 0 ? Math.round((storage.NoRunRecordBytes / storage.TotalBytes) * 100) : 0;
    return `${compactSize(storage.NoRunRecordBytes)} · ${pct}%`;
  }

  function labStorageLocation(lab: OrganizationStorageLab) {
    return orgStorageLabLocation(props.orgId, lab.LaboratoryId, props.superuser);
  }

  function openLabStorage(lab: OrganizationStorageLab) {
    void router.push(labStorageLocation(lab));
  }

  const columns = [
    { key: 'Name', label: 'Lab', sortable: true },
    { key: 'Stored', label: 'Stored', sortable: true, class: 'w-28', rowClass: 'w-28' },
    { key: 'NotLinked', label: 'Not linked to a run', sortable: true, class: 'w-44', rowClass: 'w-44' },
    { key: 'Runs', label: 'Runs', class: 'w-20', rowClass: 'w-20' },
    { key: 'Retention', label: 'Retention', class: 'w-32', rowClass: 'w-32' },
  ];
</script>

<template>
  <section aria-label="Organization storage" class="space-y-4">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(totals.totalBytes) }}</p>
        <p class="text-muted text-xs">Stored across {{ labs.length }} lab{{ labs.length === 1 ? '' : 's' }}</p>
      </div>
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(totals.noRunRecordBytes) }}</p>
        <p class="text-muted text-xs">Not linked to a run</p>
      </div>
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-heading text-2xl font-semibold">
          {{ totals.labsWithStorage === 0 ? '—' : `US$${Math.round(totals.estimatedMonthlyUsd)}` }}
        </p>
        <p class="text-muted text-xs">Estimated monthly storage</p>
      </div>
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-8" />
        <p v-else class="text-heading text-2xl font-semibold">{{ totals.labsWithNoRetention }}</p>
        <p class="text-muted text-xs">Labs with no retention set</p>
      </div>
    </div>

    <p v-if="savingLine" class="text-muted text-xs">{{ savingLine }}</p>

    <EGTable
      v-model:sort="tableSort"
      :table-data="sortedLabs"
      :columns="columns"
      :is-loading="isLoading"
      :show-pagination="!isLoading"
      :row-click-action="openLabStorage"
    >
      <template v-for="sortColumn in SORTABLE_COLUMNS" :key="sortColumn" #[`${sortColumn}-header`]="{ column }">
        <UButton
          color="gray"
          variant="ghost"
          class="-m-1.5"
          trailing
          :label="column.label"
          :icon="sortIcon(sortColumn)"
          @click="tableSort = nextOrgStorageSort(tableSort, sortColumn)"
        />
      </template>
      <template #Name-data="{ row }">
        <div class="flex min-w-0 items-start gap-2">
          <UIcon name="i-heroicons-circle-stack" class="text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div class="min-w-0">
            <!-- EGTable rows take no keyboard focus, so the name is the keyboard path into the lab. -->
            <NuxtLink
              :to="labStorageLocation(row)"
              class="text-heading focus-visible:outline-primary-500 block truncate rounded text-sm font-semibold hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2"
              @click.stop
            >
              {{ row.Name }}
            </NuxtLink>
            <p class="text-muted/70 mt-1 truncate font-mono text-xs">{{ row.S3Bucket || 'No bucket set' }}</p>
          </div>
        </div>
      </template>
      <template #Stored-data="{ row }">
        <span class="text-heading text-sm font-semibold">
          {{ row.Storage ? compactSize(row.Storage.TotalBytes) : '—' }}
        </span>
      </template>
      <template #NotLinked-data="{ row }">
        <span class="text-body text-sm">{{ noRunRecordCell(row) }}</span>
      </template>
      <template #Runs-data="{ row }">
        <span class="text-body text-sm">{{ row.Storage?.RunCount ?? '—' }}</span>
      </template>
      <template #Retention-data="{ row }">
        <span class="text-sm" :class="row.RunRetentionMonths === 0 ? 'text-alert-caution font-medium' : 'text-body'">
          {{ retentionLabel(row.RunRetentionMonths) }}
        </span>
      </template>
    </EGTable>

    <div class="text-muted my-6 text-center text-xs" role="note">
      Retention is set per lab. This organization can only be removed by contacting your System administrator at:
      [System admin email]
    </div>
  </section>
</template>
