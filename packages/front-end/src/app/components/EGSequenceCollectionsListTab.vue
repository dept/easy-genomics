<script setup lang="ts">
  import type { LaboratorySequenceCollection } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import EGActionButton from '@FE/components/EGActionButton.vue';

  const props = defineProps<{
    collections: LaboratorySequenceCollection[];
    loading: boolean;
    search: string;
  }>();

  const emit = defineEmits<{
    'update:search': [value: string];
    'new-collection': [];
    'launch-workflow': [collection: LaboratorySequenceCollection];
    'edit-collection': [collection: LaboratorySequenceCollection];
    'delete-collection': [collection: LaboratorySequenceCollection];
  }>();

  function collectionActionItems(collection: LaboratorySequenceCollection): object[] {
    return [
      [{ label: 'Launch Workflow', click: () => emit('launch-workflow', collection) }],
      [{ label: 'Edit', click: () => emit('edit-collection', collection) }],
      [{ label: 'Delete', click: () => emit('delete-collection', collection), isHighlighted: true }],
    ];
  }

  const filtered = computed(() => {
    const q = props.search.trim().toLowerCase();
    if (!q) return props.collections;
    return props.collections.filter((c) => c.Name.toLowerCase().includes(q));
  });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white">
    <div class="flex items-center gap-2 border-b border-gray-200 p-3">
      <UInput
        :model-value="search"
        placeholder="Search sequence collections…"
        class="max-w-xs"
        @update:model-value="emit('update:search', String($event ?? ''))"
      />
      <div class="flex-1" />
      <UButton variant="outline" @click="emit('new-collection')">+ New Sequence Collection</UButton>
    </div>

    <div class="flex-1 overflow-y-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-50">
          <tr>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Name</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Samples</th>
            <th class="p-3 text-left text-xs uppercase text-gray-400">Schema</th>
            <th class="p-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="4" class="p-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="!filtered.length">
            <td colspan="4" class="p-6 text-center text-gray-400">No sequence collections yet.</td>
          </tr>
          <tr v-for="c in filtered" :key="c.SequenceCollectionId" class="border-t border-gray-100 hover:bg-gray-50">
            <td class="p-3">
              <div class="font-medium">{{ c.Name }}</div>
              <div v-if="c.CreatedAt" class="text-xs text-gray-400">
                Created {{ new Date(c.CreatedAt).toLocaleDateString() }}
              </div>
            </td>
            <td class="p-3">{{ c.SampleCount }}</td>
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
  </div>
</template>
