<script setup lang="ts">
  import type { TableSort } from '@FE/components/EGTable.vue';
  import EGDataCollectionsFileTypeFilter from '@FE/components/EGDataCollectionsFileTypeFilter.vue';
  import {
    dataCollectionFileKind,
    enabledFileTypeKinds,
    fileMatchesFileTypeFilter,
    type DataCollectionFileTypeFilter,
  } from '@FE/utils/data-collections-file-type';

  type UnlinkedFile = { Key: string; Size?: number; LastModified?: string };
  type SortColumn = 'file' | 'type' | 'size' | 'lastModified';

  const props = withDefaults(
    defineProps<{
      files: UnlinkedFile[];
      loading: boolean;
      selectedKeys: string[];
      search: string;
      s3Bucket: string;
      resolvedPrefix: string;
      lastScanLabel: string;
      s3Configured?: boolean;
      canEditLabDetails?: boolean;
    }>(),
    {
      s3Configured: true,
      canEditLabDetails: false,
    },
  );

  const emit = defineEmits<{
    'update:selectedKeys': [keys: string[]];
    'update:search': [value: string];
    rescan: [];
    'build-sample': [];
    'group-with-regex': [];
    'open-settings': [];
  }>();

  const fileTypeFilter = ref<DataCollectionFileTypeFilter>({ fastq: true, fasta: false, other: false });
  const enabledKinds = computed(() => enabledFileTypeKinds(fileTypeFilter.value));

  const sortHelpers = useSort();
  const tableSort = ref<TableSort>({ column: 'file', direction: 'asc' });

  const filtered = computed(() => {
    let rows = props.files.filter((f) => fileMatchesFileTypeFilter(f.Key, enabledKinds.value));
    const q = props.search.trim().toLowerCase();
    if (q) rows = rows.filter((f) => f.Key.toLowerCase().includes(q));
    return rows;
  });

  function fileName(key: string): string {
    return key.split('/').pop() ?? key;
  }

  /** Rows with no lastModified sort after dated rows for a stable column sort. */
  function compareLastModified(
    a: string | undefined,
    b: string | undefined,
    direction: 'asc' | 'desc' = 'asc',
  ): number {
    const toTime = (s?: string): number | null => {
      if (!s) return null;
      const ms = new Date(s).getTime();
      return Number.isNaN(ms) ? null : ms;
    };
    const ta = toTime(a);
    const tb = toTime(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    const result = ta - tb;
    return direction === 'asc' ? result : -result;
  }

  const sorted = computed(() => {
    const rows = [...filtered.value];
    const { column, direction } = tableSort.value as { column: SortColumn; direction: 'asc' | 'desc' };

    rows.sort((rowA, rowB) => {
      let cmp = 0;
      switch (column) {
        case 'file':
          cmp = sortHelpers.stringSortCompare(fileName(rowA.Key), fileName(rowB.Key), direction);
          break;
        case 'type':
          cmp = sortHelpers.stringSortCompare(
            dataCollectionFileKind(rowA.Key),
            dataCollectionFileKind(rowB.Key),
            direction,
          );
          break;
        case 'size':
          cmp = sortHelpers.numberSortCompare(rowA.Size ?? 0, rowB.Size ?? 0, direction);
          break;
        case 'lastModified':
          cmp = compareLastModified(rowA.LastModified, rowB.LastModified, direction);
          break;
      }
      if (cmp !== 0) return cmp;
      return sortHelpers.stringSortCompare(rowA.Key, rowB.Key, direction);
    });

    return rows;
  });

  function toggleSort(column: SortColumn): void {
    if (tableSort.value.column === column) {
      tableSort.value = { column, direction: tableSort.value.direction === 'asc' ? 'desc' : 'asc' };
      return;
    }
    tableSort.value = { column, direction: 'asc' };
  }

  function sortIcon(column: SortColumn): string {
    if (tableSort.value.column !== column) return 'i-heroicons-chevron-up-down';
    return tableSort.value.direction === 'asc' ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down';
  }

  function ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (tableSort.value.column !== column) return 'none';
    return tableSort.value.direction === 'asc' ? 'ascending' : 'descending';
  }

  const hiddenCount = computed(() => {
    const all = props.files.length;
    const visible = props.files.filter((f) => fileMatchesFileTypeFilter(f.Key, enabledKinds.value)).length;
    return all - visible;
  });

  const fileTypeCounts = computed(() => {
    const counts = { fastq: 0, fasta: 0, other: 0 };
    for (const f of props.files) {
      counts[dataCollectionFileKind(f.Key)] += 1;
    }
    return counts;
  });

  function toggle(key: string): void {
    const next = new Set(props.selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    emit('update:selectedKeys', [...next]);
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return '—';
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${bytes} B`;
  }
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white">
    <div class="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
      <UInput
        :model-value="search"
        placeholder="Search file names…"
        class="max-w-xs"
        @update:model-value="emit('update:search', String($event ?? ''))"
      />
      <EGDataCollectionsFileTypeFilter v-model="fileTypeFilter" :counts="fileTypeCounts" />
      <div class="flex-1" />
      <UButton variant="outline" :loading="loading" :disabled="!s3Configured" @click="emit('rescan')">
        Rescan bucket
      </UButton>
    </div>

    <div v-if="!s3Configured" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p class="max-w-lg text-sm text-gray-600">
        <template v-if="canEditLabDetails">
          Configure a
          <strong>default S3 bucket</strong>
          in lab Settings to scan unlinked files in storage.
        </template>
        <template v-else>
          Ask your organization administrator to configure the lab's
          <strong>default S3 bucket</strong>
          in Settings before files can be scanned.
        </template>
      </p>
      <UButton v-if="canEditLabDetails" size="sm" variant="outline" @click="emit('open-settings')">
        Open Settings
      </UButton>
    </div>

    <template v-else>
      <div class="border-b bg-gray-50 px-4 py-2 text-xs text-gray-500">
        Scanned from
        <span class="font-mono text-gray-800">s3://{{ s3Bucket }}/{{ resolvedPrefix }}</span>
        ·
        <strong>{{ files.length }}</strong>
        unlinked files
        <span v-if="lastScanLabel">· {{ lastScanLabel }}</span>
      </div>

      <div class="flex-1 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-50">
            <tr>
              <th class="w-10 p-3" />
              <th class="p-3 text-left text-xs uppercase text-gray-400" scope="col" :aria-sort="ariaSort('file')">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 uppercase hover:text-gray-600"
                  @click="toggleSort('file')"
                >
                  File
                  <UIcon :name="sortIcon('file')" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </th>
              <th class="p-3 text-left text-xs uppercase text-gray-400" scope="col" :aria-sort="ariaSort('type')">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 uppercase hover:text-gray-600"
                  @click="toggleSort('type')"
                >
                  Type
                  <UIcon :name="sortIcon('type')" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </th>
              <th class="p-3 text-left text-xs uppercase text-gray-400" scope="col" :aria-sort="ariaSort('size')">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 uppercase hover:text-gray-600"
                  @click="toggleSort('size')"
                >
                  Size
                  <UIcon :name="sortIcon('size')" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </th>
              <th
                class="p-3 text-left text-xs uppercase text-gray-400"
                scope="col"
                :aria-sort="ariaSort('lastModified')"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-1 uppercase hover:text-gray-600"
                  @click="toggleSort('lastModified')"
                >
                  Last modified
                  <UIcon :name="sortIcon('lastModified')" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="p-6 text-center text-gray-400">Scanning…</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td colspan="5" class="p-6 text-center text-gray-400">No unlinked files match the current filters.</td>
            </tr>
            <tr
              v-for="f in sorted"
              :key="f.Key"
              class="border-t border-gray-100 hover:bg-gray-50"
              :class="{ 'bg-primary-50': selectedKeys.includes(f.Key) }"
            >
              <td class="p-3">
                <input type="checkbox" :checked="selectedKeys.includes(f.Key)" @change="toggle(f.Key)" />
              </td>
              <td class="p-3 font-mono text-xs">{{ fileName(f.Key) }}</td>
              <td class="p-3 text-xs uppercase text-gray-500">{{ dataCollectionFileKind(f.Key) }}</td>
              <td class="p-3 text-xs">{{ formatSize(f.Size) }}</td>
              <td class="p-3 text-xs text-gray-400">
                {{ f.LastModified ? new Date(f.LastModified).toLocaleString() : '—' }}
              </td>
            </tr>
            <tr v-if="hiddenCount > 0">
              <td colspan="5" class="p-3 text-center text-xs italic text-gray-400">
                {{ hiddenCount }} file(s) hidden by type filter
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="selectedKeys.length" class="flex items-center justify-between border-t border-gray-200 bg-white p-3">
        <span class="text-sm text-gray-500">
          <strong>{{ selectedKeys.length }}</strong>
          selected
        </span>
        <div class="flex gap-2">
          <UButton variant="outline" :disabled="selectedKeys.length < 2" @click="emit('group-with-regex')">
            Group with regex
          </UButton>
          <UButton @click="emit('build-sample')">Build sample</UButton>
        </div>
      </div>
    </template>
  </div>
</template>
