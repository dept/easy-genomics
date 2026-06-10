<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type {
    LaboratoryRunDataCollection,
    LaboratorySequenceSet,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
  import { useLabsStore, useUiStore } from '@FE/stores';
  import EGBuildSequenceSetModal from '@FE/components/EGBuildSequenceSetModal.vue';
  import EGBuildSequenceSetsFromRegexModal from '@FE/components/EGBuildSequenceSetsFromRegexModal.vue';
  import EGDataCollectionBuilder from '@FE/components/EGDataCollectionBuilder.vue';
  import EGDataCollectionsListTab from '@FE/components/EGDataCollectionsListTab.vue';
  import EGDataCollectionsTabBar, { type DataCollectionsTab } from '@FE/components/EGDataCollectionsTabBar.vue';
  import EGImportDataWizard from '@FE/components/EGImportDataWizard.vue';
  import EGRunFromDataCollectionModal from '@FE/components/EGRunFromDataCollectionModal.vue';
  import EGSequenceSetsTab from '@FE/components/EGSequenceSetsTab.vue';
  import EGUnlinkedFilesTab from '@FE/components/EGUnlinkedFilesTab.vue';

  const props = defineProps<{ labId: string }>();

  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();
  const uiStore = useUiStore();

  type View = 'main' | 'import' | 'builder';

  const lab = computed<Laboratory | null>(() => labsStore.labs[props.labId] ?? null);
  const view = ref<View>('main');
  const activeTab = ref<DataCollectionsTab>('sequence-sets');

  const tags = ref<LaboratoryDataTag[]>([]);
  const sequenceSets = ref<LaboratorySequenceSet[]>([]);
  const dataCollections = ref<LaboratoryRunDataCollection[]>([]);
  const setIdToTagIds = ref<Record<string, string[]>>({});
  const unlinkedFiles = ref<Array<{ Key: string; Size?: number; LastModified?: string }>>([]);
  const unlinkedMeta = ref({ s3Bucket: '', resolvedPrefix: '', lastScanLabel: '' });

  const collectionSearch = ref('');
  const sequenceSetSearch = ref('');
  const fileSearch = ref('');
  const tagsFilterUntagged = ref(false);
  const tagsFilterTagIds = ref<string[]>([]);

  const selectedCollectionIds = ref<string[]>([]);
  const selectedSequenceSetIds = ref<string[]>([]);
  const selectedFileKeys = ref<string[]>([]);

  const showBuildSequenceSetModal = ref(false);
  const showRegexGroupModal = ref(false);
  const showRunModal = ref(false);
  const runCollection = ref<LaboratoryRunDataCollection | null>(null);
  const builderInitialSetIds = ref<string[]>([]);
  const builderInitialName = ref('');
  const builderEditingCollection = ref<LaboratoryRunDataCollection | null>(null);

  const loading = computed(() =>
    uiStore.anyRequestPending([
      'dataCollectionsList',
      'dataCollectionsTags',
      'dataCollectionsMutate',
      'dataCollectionsSequenceSets',
      'dataCollectionsRunCollections',
    ]),
  );

  async function loadTags(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsTags');
    try {
      const res = await $api.dataCollections.listTags(props.labId);
      tags.value = res.Tags;
    } finally {
      uiStore.setRequestComplete('dataCollectionsTags');
    }
  }

  async function loadSequenceSets(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsSequenceSets');
    try {
      const res = await $api.dataCollections.listSequenceSets(props.labId);
      sequenceSets.value = res.SequenceSets;
      if (res.SequenceSets.length) {
        const CHUNK = 100;
        const tagMap: Record<string, string[]> = {};
        for (let i = 0; i < res.SequenceSets.length; i += CHUNK) {
          const chunk = res.SequenceSets.slice(i, i + CHUNK).map((s) => s.SequenceSetId);
          const tr = await $api.dataCollections.requestListSequenceSetTags({
            LaboratoryId: props.labId,
            SequenceSetIds: chunk,
          });
          for (const a of tr.SequenceSets) {
            tagMap[a.SequenceSetId] = a.TagIds;
          }
        }
        setIdToTagIds.value = tagMap;
      } else {
        setIdToTagIds.value = {};
      }
    } finally {
      uiStore.setRequestComplete('dataCollectionsSequenceSets');
    }
  }

  async function loadDataCollections(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunCollections');
    try {
      const res = await $api.dataCollections.listDataCollections(props.labId);
      dataCollections.value = res.DataCollections ?? [];
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunCollections');
    }
  }

  async function loadUnlinkedFiles(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsList');
    try {
      const res = await $api.dataCollections.requestUnlinkedBucketObjects({
        LaboratoryId: props.labId,
        MaxTotalKeys: 25_000,
      });
      unlinkedFiles.value = res.Contents || [];
      unlinkedMeta.value = {
        s3Bucket: res.S3Bucket,
        resolvedPrefix: res.ResolvedPrefix,
        lastScanLabel: `Last scan ${new Date().toLocaleTimeString()}`,
      };
    } finally {
      uiStore.setRequestComplete('dataCollectionsList');
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([loadTags(), loadSequenceSets(), loadDataCollections(), loadUnlinkedFiles()]);
  }

  async function onSequenceSetTagsUpdated(): Promise<void> {
    await loadSequenceSets();
  }

  async function onSequenceSetTagCreated(): Promise<void> {
    await loadTags();
  }

  async function onSequenceSetTagDeleted(): Promise<void> {
    await Promise.all([loadTags(), loadSequenceSets()]);
  }

  onMounted(() => void refreshAll());

  watch(
    () => props.labId,
    () => void refreshAll(),
  );

  function openImport(): void {
    view.value = 'import';
  }

  function openBuilder(setIds: string[] = [], name = ''): void {
    builderEditingCollection.value = null;
    builderInitialSetIds.value = setIds;
    builderInitialName.value = name;
    view.value = 'builder';
  }

  async function openBuilderForEdit(collection: LaboratoryRunDataCollection): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunCollections');
    try {
      const res = await $api.dataCollections.listDataCollectionSequenceSets(props.labId, collection.DataCollectionId);
      builderEditingCollection.value = collection;
      builderInitialSetIds.value = res.SequenceSetIds;
      builderInitialName.value = collection.Name;
      view.value = 'builder';
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunCollections');
    }
  }

  function onImportCompleted(): void {
    view.value = 'main';
    activeTab.value = 'sequence-sets';
    void refreshAll();
  }

  function onBuilderSaved(): void {
    view.value = 'main';
    builderEditingCollection.value = null;
    activeTab.value = 'collections';
    void refreshAll();
  }

  function closeBuilder(): void {
    view.value = 'main';
    builderEditingCollection.value = null;
  }

  function launchWorkflow(c: LaboratoryRunDataCollection): void {
    runCollection.value = c;
    showRunModal.value = true;
  }
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <EGImportDataWizard
      v-if="view === 'import'"
      :lab-id="labId"
      :lab="lab"
      :tags="tags"
      @back="view = 'main'"
      @completed="onImportCompleted"
    />

    <EGDataCollectionBuilder
      v-else-if="view === 'builder'"
      :lab-id="labId"
      :lab="lab"
      :sequence-sets="sequenceSets"
      :initial-set-ids="builderInitialSetIds"
      :initial-name="builderInitialName"
      :editing-collection="builderEditingCollection"
      @back="closeBuilder"
      @saved="onBuilderSaved"
    />

    <template v-else>
      <div class="mb-1">
        <h1 class="text-2xl font-medium">Data Collections</h1>
        <p class="text-sm text-gray-500">Saved bundles of sequence sets, ready to launch a workflow on.</p>
      </div>

      <EGDataCollectionsTabBar
        v-model:active-tab="activeTab"
        :collection-count="dataCollections.length"
        :sequence-set-count="sequenceSets.length"
        :file-count="unlinkedFiles.length"
      />

      <EGDataCollectionsListTab
        v-if="activeTab === 'collections'"
        :collections="dataCollections"
        :loading="loading"
        :selected-ids="selectedCollectionIds"
        :search="collectionSearch"
        @update:selected-ids="selectedCollectionIds = $event"
        @update:search="collectionSearch = $event"
        @new-collection="openBuilder()"
        @import="openImport"
        @launch-workflow="launchWorkflow"
        @edit-collection="openBuilderForEdit"
      />

      <EGSequenceSetsTab
        v-else-if="activeTab === 'sequence-sets'"
        :lab-id="labId"
        :sequence-sets="sequenceSets"
        :tags="tags"
        :set-id-to-tag-ids="setIdToTagIds"
        :loading="loading"
        :selected-ids="selectedSequenceSetIds"
        :search="sequenceSetSearch"
        :tags-filter-untagged="tagsFilterUntagged"
        :tags-filter-tag-ids="tagsFilterTagIds"
        @update:selected-ids="selectedSequenceSetIds = $event"
        @update:search="sequenceSetSearch = $event"
        @update:tags-filter-untagged="tagsFilterUntagged = $event"
        @update:tags-filter-tag-ids="tagsFilterTagIds = $event"
        @import="openImport"
        @build-collection="openBuilder(selectedSequenceSetIds)"
        @tags-updated="onSequenceSetTagsUpdated"
        @tag-created="onSequenceSetTagCreated"
        @tag-deleted="onSequenceSetTagDeleted"
      />

      <EGUnlinkedFilesTab
        v-else
        :files="unlinkedFiles"
        :loading="loading"
        :selected-keys="selectedFileKeys"
        :search="fileSearch"
        :s3-bucket="unlinkedMeta.s3Bucket"
        :resolved-prefix="unlinkedMeta.resolvedPrefix"
        :last-scan-label="unlinkedMeta.lastScanLabel"
        @update:selected-keys="selectedFileKeys = $event"
        @update:search="fileSearch = $event"
        @rescan="loadUnlinkedFiles"
        @build-sequence-set="showBuildSequenceSetModal = true"
        @group-with-regex="showRegexGroupModal = true"
      />
    </template>

    <EGBuildSequenceSetModal
      v-model="showBuildSequenceSetModal"
      :lab-id="labId"
      :lab="lab"
      :selected-keys="selectedFileKeys"
      @created="
        () => {
          selectedFileKeys = [];
          activeTab = 'sequence-sets';
          refreshAll();
        }
      "
    />

    <EGBuildSequenceSetsFromRegexModal
      v-model="showRegexGroupModal"
      :lab-id="labId"
      :lab="lab"
      :file-keys="selectedFileKeys"
      @created="
        () => {
          selectedFileKeys = [];
          activeTab = 'sequence-sets';
          refreshAll();
        }
      "
    />

    <EGRunFromDataCollectionModal v-model="showRunModal" :lab-id="labId" :lab="lab" :data-collection="runCollection" />
  </div>
</template>
