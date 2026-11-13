<script setup lang="ts">
  import type { OrganizationStorageLab } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { formatFileSize } from '@FE/utils/file-size';

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
      if (lab.RunRetentionMonths == null || lab.RunRetentionMonths === 0) labsWithNoRetention += 1;
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

  function retentionBadge(months: number | undefined): { label: string; class: string } {
    if (months == null) {
      return { label: 'Not set', class: 'bg-alert-caution-muted text-alert-caution' };
    }
    if (months === 0) {
      return { label: 'Never', class: 'bg-alert-caution-muted text-alert-caution' };
    }
    return {
      label: `${months} month${months === 1 ? '' : 's'}`,
      class: 'bg-alert-success-muted text-alert-success-text',
    };
  }

  function noRunRecordCell(lab: OrganizationStorageLab): string {
    const storage = lab.Storage;
    if (!storage || storage.NoRunRecordBytes <= 0) return 'None';
    const pct = storage.TotalBytes > 0 ? Math.round((storage.NoRunRecordBytes / storage.TotalBytes) * 100) : 0;
    return `${compactSize(storage.NoRunRecordBytes)} · ${pct}%`;
  }

  function manageLab(labId: string) {
    // /admin is system-admin only; org admins open the lab they already have access to.
    const path = props.superuser ? `/admin/orgs/${props.orgId}/labs/${labId}` : `/labs/${labId}`;
    void router.push({ path, query: { tab: 'storage' } });
  }

  const columns = [
    { key: 'Name', label: 'Lab' },
    { key: 'Total', label: 'Total', class: 'w-28', rowClass: 'w-28' },
    { key: 'NoRunRecord', label: 'No run record', class: 'w-40', rowClass: 'w-40' },
    { key: 'Runs', label: 'Runs', class: 'w-20', rowClass: 'w-20' },
    { key: 'Retention', label: 'Retention', class: 'w-32', rowClass: 'w-32' },
    { key: 'actions', label: '', class: 'w-28', rowClass: 'w-28' },
  ];
</script>

<template>
  <section aria-label="Organization storage" class="space-y-4">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-heading text-2xl font-semibold">{{ compactSize(totals.totalBytes) }}</p>
        <p class="text-muted text-xs">
          Stored across {{ labs.length }} lab{{ labs.length === 1 ? '' : 's' }}
        </p>
      </div>
      <div class="border-alert-caution bg-alert-caution-muted rounded-2xl border p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-alert-caution text-2xl font-semibold">{{ compactSize(totals.noRunRecordBytes) }}</p>
        <p class="text-muted text-xs">With no run record</p>
      </div>
      <div class="border-stroke-light rounded-2xl border bg-white p-4">
        <USkeleton v-if="isLoading" class="h-8 w-24" />
        <p v-else class="text-heading text-2xl font-semibold">
          {{ totals.labsWithStorage === 0 ? '—' : `US$${Math.round(totals.estimatedMonthlyUsd)}` }}
        </p>
        <p class="text-muted text-xs">Estimated monthly storage</p>
      </div>
      <div class="border-alert-caution bg-alert-caution-muted rounded-2xl border p-4">
        <USkeleton v-if="isLoading" class="h-8 w-8" />
        <p v-else class="text-alert-caution text-2xl font-semibold">{{ totals.labsWithNoRetention }}</p>
        <p class="text-muted text-xs">Labs with no retention set</p>
      </div>
    </div>

    <p v-if="savingLine" class="text-muted text-xs">{{ savingLine }}</p>

    <EGTable :table-data="labs" :columns="columns" :is-loading="isLoading" :show-pagination="!isLoading">
      <template #Name-data="{ row }">
        <div class="flex min-w-0 items-start gap-2">
          <UIcon name="i-heroicons-circle-stack" class="text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-heading truncate text-sm font-semibold">{{ row.Name }}</p>
            <p class="text-muted/70 mt-1 truncate font-mono text-xs">{{ row.S3Bucket || 'No bucket set' }}</p>
          </div>
        </div>
      </template>
      <template #Total-data="{ row }">
        <span class="text-heading text-sm font-semibold">
          {{ row.Storage ? compactSize(row.Storage.TotalBytes) : '—' }}
        </span>
      </template>
      <template #NoRunRecord-data="{ row }">
        <span class="text-body text-sm">{{ noRunRecordCell(row) }}</span>
      </template>
      <template #Runs-data="{ row }">
        <span class="text-body text-sm">{{ row.Storage?.RunCount ?? '—' }}</span>
      </template>
      <template #Retention-data="{ row }">
        <span
          class="inline-flex rounded-xl px-3 py-1 text-xs font-semibold uppercase"
          :class="retentionBadge(row.RunRetentionMonths).class"
        >
          {{ retentionBadge(row.RunRetentionMonths).label }}
        </span>
      </template>
      <template #actions-data="{ row }">
        <div class="flex justify-end">
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            :variant="ButtonVariantEnum.enum.secondary"
            label="Manage"
            :aria-label="`Manage storage for ${row.Name}`"
            @click="manageLab(row.LaboratoryId)"
          />
        </div>
      </template>
    </EGTable>

    <div class="text-muted my-6 text-center text-xs" role="note">
      Retention is set per lab. This organization can only be removed by contacting your System administrator at:
      [System admin email]
    </div>
  </section>
</template>
