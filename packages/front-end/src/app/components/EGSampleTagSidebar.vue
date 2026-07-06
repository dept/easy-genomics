<script setup lang="ts">
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type { LaboratorySample } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import EGDialog from '@FE/components/EGDialog.vue';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import { filterSamplesBySearch } from '@FE/utils/data-collections-filters';
  import { exceedsTagNameMaxLength } from '@FE/utils/data-collections-name-validation';

  const props = defineProps<{
    labId: string;
    tags: LaboratoryDataTag[];
    samples: LaboratorySample[];
    sampleIdToTagIds: Record<string, string[]>;
    search: string;
    tagsFilterUntagged: boolean;
    tagsFilterTagIds: string[];
    loading: boolean;
  }>();

  const emit = defineEmits<{
    'update:tagsFilterUntagged': [value: boolean];
    'update:tagsFilterTagIds': [ids: string[]];
    'tag-created': [];
    'tag-deleted': [tagId: string];
  }>();

  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const uiStore = useUiStore();

  const tagsSectionExpanded = ref(true);
  const showLeftRailCreateTag = ref(false);
  const leftRailNewTagName = ref('');
  const leftRailNewTagColor = ref('#5B4FD4');
  const tagToDelete = ref<LaboratoryDataTag | null>(null);
  const isDeleteTagDialogOpen = ref(false);

  const presetColors = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

  const standardTags = computed(() => props.tags.filter((t) => (t.Kind ?? 'standard') === 'standard'));

  const setsMatchingSearch = computed(() => filterSamplesBySearch(props.samples, props.tags, props.search));

  function standardTagIdsForSet(setId: string): string[] {
    const tagIdSet = new Set(standardTags.value.map((t) => t.TagId));
    return (props.sampleIdToTagIds[setId] ?? []).filter((tid) => tagIdSet.has(tid));
  }

  const standardTagIdToChipCount = computed((): Record<string, number> => {
    const tagIds = new Set(standardTags.value.map((t) => t.TagId));
    const counts = new Map<string, number>();
    for (const id of tagIds) counts.set(id, 0);
    for (const s of setsMatchingSearch.value) {
      for (const tid of standardTagIdsForSet(s.SampleId)) {
        if (tagIds.has(tid)) counts.set(tid, (counts.get(tid) ?? 0) + 1);
      }
    }
    const out: Record<string, number> = {};
    for (const [k, v] of counts) out[k] = v;
    return out;
  });

  const untaggedChipCount = computed(
    () => setsMatchingSearch.value.filter((s) => !standardTagIdsForSet(s.SampleId).length).length,
  );

  const leftRailTagNameInvalid = computed(() => exceedsTagNameMaxLength(leftRailNewTagName.value));
  const canCreateLeftRailTag = computed(() => !!leftRailNewTagName.value.trim() && !leftRailTagNameInvalid.value);

  const deleteTagAssociationCount = computed(() =>
    tagToDelete.value ? tagAssociationCount(tagToDelete.value.TagId) : 0,
  );

  const deleteTagPrimaryMessage = computed(() => (tagToDelete.value ? `Delete tag "${tagToDelete.value.Name}"?` : ''));

  const deleteTagSecondaryMessage = computed(() => {
    if (!tagToDelete.value) return '';
    const n = deleteTagAssociationCount.value;
    if (n === 0) {
      return 'This will permanently delete the tag. It is not currently applied to any samples in this lab.';
    }
    if (n === 1) {
      return 'This will permanently delete the tag and remove it from 1 sample in this lab.';
    }
    return `This will permanently delete the tag and remove it from ${n} samples in this lab.`;
  });

  const deleteTagBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));

  function tagAssociationCount(tagId: string): number {
    let count = 0;
    for (const s of props.samples) {
      if ((props.sampleIdToTagIds[s.SampleId] ?? []).includes(tagId)) count++;
    }
    return count;
  }

  function isUntaggedTagFilterActive(): boolean {
    return props.tagsFilterUntagged;
  }

  function isStandardTagFilterActive(tagId: string): boolean {
    return props.tagsFilterTagIds.includes(tagId);
  }

  function onUntaggedTagFilterClick(): void {
    if (props.tagsFilterUntagged) {
      emit('update:tagsFilterUntagged', false);
      return;
    }
    emit('update:tagsFilterUntagged', true);
    emit('update:tagsFilterTagIds', []);
  }

  function onStandardTagFilterClick(tagId: string): void {
    if (props.tagsFilterUntagged) {
      emit('update:tagsFilterUntagged', false);
    }
    const idx = props.tagsFilterTagIds.indexOf(tagId);
    if (idx >= 0) {
      emit(
        'update:tagsFilterTagIds',
        props.tagsFilterTagIds.filter((id) => id !== tagId),
      );
      return;
    }
    emit('update:tagsFilterTagIds', [...props.tagsFilterTagIds, tagId]);
  }

  function cancelLeftRailCreateTag(): void {
    showLeftRailCreateTag.value = false;
    leftRailNewTagName.value = '';
    leftRailNewTagColor.value = '#5B4FD4';
  }

  function openDeleteTagDialog(tag: LaboratoryDataTag): void {
    tagToDelete.value = tag;
    isDeleteTagDialogOpen.value = true;
  }

  function closeDeleteTagDialog(): void {
    isDeleteTagDialogOpen.value = false;
    tagToDelete.value = null;
  }

  async function confirmDeleteTag(): Promise<void> {
    if (!tagToDelete.value) return;
    const tagId = tagToDelete.value.TagId;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.deleteTag(props.labId, tagId);
      if (props.tagsFilterTagIds.includes(tagId)) {
        emit(
          'update:tagsFilterTagIds',
          props.tagsFilterTagIds.filter((id) => id !== tagId),
        );
      }
      toast.success('Tag deleted');
      closeDeleteTagDialog();
      emit('tag-deleted', tagId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete tag failed');
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }

  async function createTagLeftRail(): Promise<void> {
    const trimmed = leftRailNewTagName.value.trim();
    if (!trimmed || exceedsTagNameMaxLength(trimmed)) return;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.createTag({
        LaboratoryId: props.labId,
        Name: trimmed,
        ColorHex: leftRailNewTagColor.value,
      });
      toast.success('Tag created');
      cancelLeftRailCreateTag();
      emit('tag-created');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create tag failed');
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
  }
</script>

<template>
  <nav
    class="border-border-muted flex w-[280px] shrink-0 flex-col overflow-y-auto border-r bg-gray-50"
    aria-label="Sample tag filters"
  >
    <div class="p-2">
      <button
        type="button"
        class="text-muted hover:bg-primary-muted mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium uppercase tracking-wide"
        :aria-expanded="tagsSectionExpanded"
        @click="tagsSectionExpanded = !tagsSectionExpanded"
      >
        <UIcon
          :name="tagsSectionExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
          class="h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        <span>Tags</span>
      </button>
      <div v-show="tagsSectionExpanded">
        <button
          type="button"
          class="hover:bg-primary-muted flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
          :class="{ 'bg-primary-muted font-medium': isUntaggedTagFilterActive() }"
          @click="onUntaggedTagFilterClick"
        >
          <span>Untagged</span>
          <UBadge
            size="xs"
            class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
          >
            {{ untaggedChipCount }}
          </UBadge>
        </button>
        <div
          v-for="t in standardTags"
          :key="t.TagId"
          class="hover:bg-primary-muted group flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
          :class="{ 'bg-primary-muted font-medium': isStandardTagFilterActive(t.TagId) }"
          @click="onStandardTagFilterClick(t.TagId)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: t.ColorHex }" />
            <span class="flex min-w-0 items-center gap-0.5">
              <span class="truncate">{{ t.Name }}</span>
              <button
                type="button"
                class="text-muted hover:text-alert-danger-dark focus-visible:outline-primary shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-white/80 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 group-hover:opacity-100"
                :aria-label="`Delete tag ${t.Name}`"
                @click.stop="openDeleteTagDialog(t)"
              >
                <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
              </button>
            </span>
          </span>
          <UBadge
            size="xs"
            class="bg-primary-muted text-primary-dark shrink-0 rounded-xl border-0 font-serif tabular-nums ring-0"
          >
            {{ standardTagIdToChipCount[t.TagId] ?? 0 }}
          </UBadge>
        </div>

        <div class="border-border-muted mt-2 border-t pt-2">
          <button
            v-if="!showLeftRailCreateTag"
            type="button"
            class="text-primary hover:text-primary-dark px-2 py-1.5 text-left text-xs font-medium hover:underline"
            @click="showLeftRailCreateTag = true"
          >
            + New Tag
          </button>
          <div v-else class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div class="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Create Tag</div>
            <div class="space-y-2">
              <div>
                <label class="text-muted mb-0.5 block text-xs font-medium">Tag name</label>
                <UInput
                  v-model="leftRailNewTagName"
                  placeholder="Tag name"
                  size="sm"
                  :color="leftRailTagNameInvalid ? 'red' : undefined"
                />
                <p v-if="leftRailTagNameInvalid" class="text-alert-danger-dark mt-1 text-xs">40 characters max</p>
              </div>
              <div>
                <label class="text-muted mb-0.5 block text-xs font-medium">Tag color</label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="c in presetColors"
                    :key="'left-rail-preset-' + c"
                    type="button"
                    class="h-7 w-7 rounded border-2"
                    :class="leftRailNewTagColor === c ? 'border-primary' : 'border-transparent'"
                    :style="{ background: c }"
                    :aria-label="`Tag color ${c}`"
                    :aria-pressed="leftRailNewTagColor === c"
                    @click="leftRailNewTagColor = c"
                  />
                </div>
                <UInput v-model="leftRailNewTagColor" placeholder="#RRGGBB" size="sm" class="mt-1.5" />
              </div>
              <div class="flex gap-2 pt-1">
                <UButton size="xs" variant="ghost" @click="cancelLeftRailCreateTag">Cancel</UButton>
                <UButton size="xs" :disabled="!canCreateLeftRailTag" :loading="loading" @click="createTagLeftRail">
                  Create
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </nav>

  <EGDialog
    v-model="isDeleteTagDialogOpen"
    action-label="Delete tag"
    :action-variant="ButtonVariantEnum.enum.destructive"
    cancel-label="Cancel"
    :cancel-variant="ButtonVariantEnum.enum.secondary"
    :primary-message="deleteTagPrimaryMessage"
    :secondary-message="deleteTagSecondaryMessage"
    :loading="deleteTagBusy"
    :buttons-disabled="deleteTagBusy"
    @action-triggered="confirmDeleteTag"
    @update:model-value="(open) => !open && closeDeleteTagDialog()"
  />
</template>
