<script setup lang="ts">
  import type { LaboratoryRunDataCollection } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import EGActionButton from '@FE/components/EGActionButton.vue';

  const props = defineProps<{
    collections: LaboratoryRunDataCollection[];
    loading: boolean;
    selectedIds: string[];
    search: string;
  }>();

  const emit = defineEmits<{
    'update:selectedIds': [ids: string[]];
    'update:search': [value: string];
    'new-collection': [];
    import: [];
    'launch-workflow': [collection: LaboratoryRunDataCollection];
    'edit-collection': [collection: LaboratoryRunDataCollection];
  }>();

  function collectionActionItems(collection: LaboratoryRunDataCollection): object[] {
    return [
      [{ label: 'Launch Workflow', click: () => emit('launch-workflow', collection) }],
      [{ label: 'Edit', click: () => emit('edit-collection', collection) }],
    ];
  }

  const filtered = computed(() => {
    const q = props.search.trim().toLowerCase();
    if (!q) return props.collections;
    return props.collections.filter((c) => c.Name.toLowerCase().includes(q));
  });

  function toggle(id: string): void {
    const next = new Set(props.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit('update:selectedIds', [...next]);
  }

  function toggleAll(): void {
    if (props.selectedIds.length === filtered.value.length) {
      emit('update:selectedIds', []);
    } else {
      emit(
        'update:selectedIds',
        filtered.value.map((c) => c.DataCollectionId),
      );
    }
  }
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white">
    <div class="flex items-center gap-2 border-b border-gray-200 p-3">
      <UInput
        :model-value="search"
        placeholder="Search collections…"
        class="max-w-xs"
        @update:model-value="emit('update:search', String($event ?? ''))"
      />
      <div class="flex-1" />
      <UButton variant="outline" @click="emit('new-collection')">+ New collection</UButton>
      <UButton @click="emit('import')">Import data</UButton>
    </div>

    <div class="flex-1 overflow-y-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-50">
          <tr>
            <th class="w-10 p-3 text-left">
              <input
                type="checkbox"
                :checked="selectedIds.length === filtered.length && filtered.length > 0"
                @change="toggleAll"
              />
            </th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Name</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Sequence sets</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Schema</th>
            <th class="p-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="p-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="!filtered.length">
            <td colspan="5" class="p-6 text-center text-gray-400">No data collections yet.</td>
          </tr>
          <tr
            v-for="c in filtered"
            :key="c.DataCollectionId"
            class="border-t border-gray-100 hover:bg-gray-50"
            :class="{ 'bg-primary-50': selectedIds.includes(c.DataCollectionId) }"
          >
            <td class="p-3">
              <input
                type="checkbox"
                :checked="selectedIds.includes(c.DataCollectionId)"
                @change="toggle(c.DataCollectionId)"
              />
            </td>
            <td class="p-3">
              <div class="font-medium">{{ c.Name }}</div>
              <div v-if="c.CreatedAt" class="text-xs text-gray-400">
                Created {{ new Date(c.CreatedAt).toLocaleDateString() }}
              </div>
            </td>
            <td class="p-3">{{ c.SequenceSetCount }}</td>
            <td class="p-3 text-gray-500">{{ c.Columns.length }} cols</td>
            <td class="p-3 text-right">
              <div class="flex justify-end">
                <EGActionButton
                  menu-label="Collection actions"
                  :items="collectionActionItems(c)"
                  @click="$event.stopPropagation()"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selectedIds.length" class="flex items-center justify-between border-t border-gray-200 bg-white p-3">
      <span class="text-sm text-gray-500">
        <strong>{{ selectedIds.length }}</strong>
        selected
      </span>
      <UButton
        v-if="selectedIds.length === 1"
        @click="emit('launch-workflow', filtered.find((c) => c.DataCollectionId === selectedIds[0])!)"
      >
        Launch workflow
      </UButton>
    </div>
  </div>
</template>
