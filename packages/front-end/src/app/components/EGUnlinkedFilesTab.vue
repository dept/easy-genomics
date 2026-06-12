<script setup lang="ts">
  import EGDataCollectionsFileTypeFilter from '@FE/components/EGDataCollectionsFileTypeFilter.vue';
  import {
    dataCollectionFileKind,
    enabledFileTypeKinds,
    fileMatchesFileTypeFilter,
    type DataCollectionFileTypeFilter,
  } from '@FE/utils/data-collections-file-type';

  const props = defineProps<{
    files: Array<{ Key: string; Size?: number; LastModified?: string }>;
    loading: boolean;
    selectedKeys: string[];
    search: string;
    s3Bucket: string;
    resolvedPrefix: string;
    lastScanLabel: string;
  }>();

  const emit = defineEmits<{
    'update:selectedKeys': [keys: string[]];
    'update:search': [value: string];
    rescan: [];
    'build-sample': [];
    'group-with-regex': [];
  }>();

  const fileTypeFilter = ref<DataCollectionFileTypeFilter>({ fastq: true, fasta: false, other: false });
  const enabledKinds = computed(() => enabledFileTypeKinds(fileTypeFilter.value));

  const filtered = computed(() => {
    let rows = props.files.filter((f) => fileMatchesFileTypeFilter(f.Key, enabledKinds.value));
    const q = props.search.trim().toLowerCase();
    if (q) rows = rows.filter((f) => f.Key.toLowerCase().includes(q));
    return rows;
  });

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
      <UButton variant="outline" :loading="loading" @click="emit('rescan')">Rescan bucket</UButton>
    </div>

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
            <th class="p-3 text-left text-xs uppercase text-gray-400">File</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Type</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Size</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Last modified</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="p-6 text-center text-gray-400">Scanning…</td>
          </tr>
          <tr v-else-if="!filtered.length">
            <td colspan="6" class="p-6 text-center text-gray-400">No unlinked files match the current filters.</td>
          </tr>
          <tr
            v-for="f in filtered"
            :key="f.Key"
            class="border-t border-gray-100 hover:bg-gray-50"
            :class="{ 'bg-primary-50': selectedKeys.includes(f.Key) }"
          >
            <td class="p-3">
              <input type="checkbox" :checked="selectedKeys.includes(f.Key)" @change="toggle(f.Key)" />
            </td>
            <td class="p-3 font-mono text-xs">{{ f.Key.split('/').pop() }}</td>
            <td class="p-3 text-xs uppercase text-gray-500">{{ dataCollectionFileKind(f.Key) }}</td>
            <td class="p-3 text-xs">{{ formatSize(f.Size) }}</td>
            <td class="p-3 text-xs text-gray-400">
              {{ f.LastModified ? new Date(f.LastModified).toLocaleString() : '—' }}
            </td>
            <td class="p-3">
              <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">unlinked</span>
            </td>
          </tr>
          <tr v-if="hiddenCount > 0">
            <td colspan="6" class="p-3 text-center text-xs italic text-gray-400">
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
  </div>
</template>
