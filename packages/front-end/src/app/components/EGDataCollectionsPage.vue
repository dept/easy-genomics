<script setup lang="ts">
  import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import type {
    LaboratoryDataTag,
    LaboratoryRunUsageSummary,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
  import type {
    LaboratorySequenceCollection,
    LaboratorySample,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
  import EGDialog from '@FE/components/EGDialog.vue';
  import { useLabsStore, useToastStore, useUiStore } from '@FE/stores';
  import { ButtonVariantEnum } from '@FE/types/buttons';
  import EGBuildSampleModal from '@FE/components/EGBuildSampleModal.vue';
  import EGBuildSamplesFromRegexModal from '@FE/components/EGBuildSamplesFromRegexModal.vue';
  import EGDataCollectionBuilder from '@FE/components/EGDataCollectionBuilder.vue';
  import EGSequenceCollectionsListTab from '@FE/components/EGSequenceCollectionsListTab.vue';
  import EGDataCollectionsTabBar, { type DataCollectionsTab } from '@FE/components/EGDataCollectionsTabBar.vue';
  import EGImportDataWizard from '@FE/components/EGImportDataWizard.vue';
  import EGRunFromDataCollectionModal from '@FE/components/EGRunFromDataCollectionModal.vue';
  import EGSamplesTab from '@FE/components/EGSamplesTab.vue';
  import EGUnlinkedFilesTab from '@FE/components/EGUnlinkedFilesTab.vue';
  import { isLaboratoryS3Configured, shouldIgnoreUnlinkedBucketObjectsError } from '@FE/utils/laboratory-s3';

  const props = defineProps<{ labId: string }>();

  const emit = defineEmits<{
    'update:explorerTab': [tab: DataCollectionsTab];
    'open-settings': [];
  }>();

  const { $api } = useNuxtApp();
  const labsStore = useLabsStore();
  const userStore = useUserStore();
  const uiStore = useUiStore();
  const toast = useToastStore();

  type View = 'main' | 'import' | 'builder';

  const lab = computed<Laboratory | null>(() => labsStore.labs[props.labId] ?? null);
  const isLabS3Configured = computed(() => isLaboratoryS3Configured(lab.value));
  const canEditLabDetails = computed(() => userStore.canEditLabDetails());
  const view = ref<View>('main');
  const activeTab = ref<DataCollectionsTab>('samples');

  watch(activeTab, (tab) => emit('update:explorerTab', tab), { immediate: true });

  const tags = ref<LaboratoryDataTag[]>([]);
  const samples = ref<LaboratorySample[]>([]);
  const sequenceCollections = ref<LaboratorySequenceCollection[]>([]);
  const sampleIdToTagIds = ref<Record<string, string[]>>({});
  const sampleIdToRunUsages = ref<Record<string, LaboratoryRunUsageSummary[]>>({});
  const unlinkedFiles = ref<Array<{ Key: string; Size?: number; LastModified?: string }>>([]);
  const unlinkedMeta = ref({ s3Bucket: '', resolvedPrefix: '', lastScanLabel: '' });

  const collectionSearch = ref('');
  const sampleSearch = ref('');
  const fileSearch = ref('');
  const tagsFilterUntagged = ref(false);
  const tagsFilterTagIds = ref<string[]>([]);

  const selectedSampleIds = ref<string[]>([]);
  const selectedFileKeys = ref<string[]>([]);

  const showBuildSampleModal = ref(false);
  const showRegexGroupModal = ref(false);
  const showRunModal = ref(false);
  const runCollection = ref<LaboratorySequenceCollection | null>(null);
  const builderInitialSampleIds = ref<string[]>([]);
  const builderInitialName = ref('');
  const builderEditingCollection = ref<LaboratorySequenceCollection | null>(null);
  const collectionToDelete = ref<LaboratorySequenceCollection | null>(null);
  const isDeleteCollectionDialogOpen = ref(false);

  const loading = computed(() =>
    uiStore.anyRequestPending([
      'dataCollectionsList',
      'dataCollectionsTags',
      'dataCollectionsMutate',
      'dataCollectionsSamples',
      'dataCollectionsRunSequenceCollections',
    ]),
  );

  async function loadTags(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsTags');
    try {
      const res = await $api.dataCollections.listTags(props.labId);
      tags.value = res.Tags;
    } catch {
      toast.error('Failed to load tags.');
    } finally {
      uiStore.setRequestComplete('dataCollectionsTags');
    }
  }

  async function loadSamples(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsSamples');
    try {
      const res = await $api.dataCollections.listSamples(props.labId);
      samples.value = res.Samples;
      if (res.Samples.length) {
        const CHUNK = 100;
        const tagMap: Record<string, string[]> = {};
        const runUsagesMap: Record<string, LaboratoryRunUsageSummary[]> = {};
        for (let i = 0; i < res.Samples.length; i += CHUNK) {
          const chunk = res.Samples.slice(i, i + CHUNK).map((s) => s.SampleId);
          const tr = await $api.dataCollections.requestListSampleTags({
            LaboratoryId: props.labId,
            SampleIds: chunk,
          });
          for (const a of tr.Samples) {
            tagMap[a.SampleId] = a.TagIds;
            runUsagesMap[a.SampleId] = a.LaboratoryRunUsages ?? [];
          }
        }
        sampleIdToTagIds.value = tagMap;
        sampleIdToRunUsages.value = runUsagesMap;
      } else {
        sampleIdToTagIds.value = {};
        sampleIdToRunUsages.value = {};
      }
    } catch {
      toast.error('Failed to load samples.');
    } finally {
      uiStore.setRequestComplete('dataCollectionsSamples');
    }
  }

  async function loadSequenceCollections(): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunSequenceCollections');
    try {
      const res = await $api.dataCollections.listSequenceCollections(props.labId);
      sequenceCollections.value = res.SequenceCollections ?? [];
    } catch {
      toast.error('Failed to load sequence collections.');
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunSequenceCollections');
    }
  }

  function clearUnlinkedFiles(): void {
    unlinkedFiles.value = [];
    unlinkedMeta.value = { s3Bucket: '', resolvedPrefix: '', lastScanLabel: '' };
  }

  async function ensureLabDetailsLoaded(): Promise<void> {
    await labsStore.loadLab(props.labId);
  }

  async function loadUnlinkedFiles(): Promise<void> {
    await ensureLabDetailsLoaded();

    if (!isLabS3Configured.value) {
      clearUnlinkedFiles();
      return;
    }

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
    } catch (e: unknown) {
      if (shouldIgnoreUnlinkedBucketObjectsError(e, lab.value)) {
        clearUnlinkedFiles();
        return;
      }
      toast.error('Failed to load unlinked files.');
    } finally {
      uiStore.setRequestComplete('dataCollectionsList');
    }
  }

  async function refreshAll(): Promise<void> {
    await ensureLabDetailsLoaded();
    const tasks = [loadTags(), loadSamples(), loadSequenceCollections()];
    if (isLabS3Configured.value) {
      tasks.push(loadUnlinkedFiles());
    } else {
      clearUnlinkedFiles();
    }
    await Promise.all(tasks);
  }

  async function onSampleTagsUpdated(): Promise<void> {
    await loadSamples();
  }

  async function onSampleTagCreated(): Promise<void> {
    await loadTags();
  }

  async function onSampleTagDeleted(): Promise<void> {
    await Promise.all([loadTags(), loadSamples()]);
  }

  onMounted(() => void refreshAll());

  watch(
    () => props.labId,
    () => void refreshAll(),
  );

  watch(
    () => lab.value?.S3Bucket,
    () => {
      if (isLabS3Configured.value) void loadUnlinkedFiles();
      else clearUnlinkedFiles();
    },
  );

  function openLabSettings(): void {
    emit('open-settings');
  }

  function openImport(): void {
    if (!isLabS3Configured.value) return;
    view.value = 'import';
  }

  function openBuilder(setIds: string[] = [], name = ''): void {
    builderEditingCollection.value = null;
    builderInitialSampleIds.value = setIds;
    builderInitialName.value = name;
    view.value = 'builder';
  }

  async function openBuilderForEdit(collection: LaboratorySequenceCollection): Promise<void> {
    uiStore.setRequestPending('dataCollectionsRunSequenceCollections');
    try {
      const res = await $api.dataCollections.listSequenceCollectionSamples(
        props.labId,
        collection.SequenceCollectionId,
      );
      builderEditingCollection.value = collection;
      builderInitialSampleIds.value = res.SampleIds;
      builderInitialName.value = collection.Name;
      view.value = 'builder';
    } finally {
      uiStore.setRequestComplete('dataCollectionsRunSequenceCollections');
    }
  }

  function onImportCompleted(): void {
    view.value = 'main';
    activeTab.value = 'samples';
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

  function launchWorkflow(c: LaboratorySequenceCollection): void {
    runCollection.value = c;
    showRunModal.value = true;
  }

  const deleteCollectionPrimaryMessage = computed(() =>
    collectionToDelete.value ? `Delete collection "${collectionToDelete.value.Name}"?` : '',
  );

  const deleteCollectionSecondaryMessage = computed(() => {
    if (!collectionToDelete.value) return '';
    const n = collectionToDelete.value.SampleCount;
    if (n === 0) {
      return 'This will permanently delete the sequence collection. Its samples and files will not be affected.';
    }
    if (n === 1) {
      return 'This will permanently delete the sequence collection. The 1 sample it contains will not be deleted.';
    }
    return `This will permanently delete the sequence collection. The ${n} samples it contains will not be deleted.`;
  });

  const deleteCollectionBusy = computed(() => uiStore.isRequestPending('dataCollectionsMutate'));

  function openDeleteCollectionDialog(collection: LaboratorySequenceCollection): void {
    collectionToDelete.value = collection;
    isDeleteCollectionDialogOpen.value = true;
  }

  function closeDeleteCollectionDialog(): void {
    isDeleteCollectionDialogOpen.value = false;
    collectionToDelete.value = null;
  }

  async function confirmDeleteCollection(): Promise<void> {
    if (!collectionToDelete.value) return;
    const collectionId = collectionToDelete.value.SequenceCollectionId;
    uiStore.setRequestPending('dataCollectionsMutate');
    try {
      await $api.dataCollections.deleteSequenceCollection(props.labId, collectionId);
      toast.success('Sequence collection deleted');
      closeDeleteCollectionDialog();
      await loadSequenceCollections();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete sequence collection');
    } finally {
      uiStore.setRequestComplete('dataCollectionsMutate');
    }
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
      :samples="samples"
      :initial-set-ids="builderInitialSampleIds"
      :initial-name="builderInitialName"
      :editing-collection="builderEditingCollection"
      @back="closeBuilder"
      @saved="onBuilderSaved"
    />

    <template v-else>
      <div
        v-if="!isLabS3Configured"
        class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <p v-if="canEditLabDetails">
          This lab does not have a
          <strong>default S3 bucket</strong>
          configured. Open
          <strong>Settings</strong>
          and set
          <strong>Default S3 bucket directory</strong>
          to enable data collections features.
        </p>
        <p v-else>
          This lab does not have a default S3 bucket configured. Ask your
          <strong>organization administrator</strong>
          to set
          <strong>Default S3 bucket directory</strong>
          in lab settings to enable data collections features.
        </p>
        <UButton v-if="canEditLabDetails" class="mt-3" size="sm" variant="outline" @click="openLabSettings">
          Open Settings
        </UButton>
      </div>

      <EGDataCollectionsTabBar
        v-model:active-tab="activeTab"
        :collection-count="sequenceCollections.length"
        :sample-count="samples.length"
        :file-count="unlinkedFiles.length"
      />

      <EGSequenceCollectionsListTab
        v-if="activeTab === 'collections'"
        :collections="sequenceCollections"
        :loading="loading"
        :search="collectionSearch"
        @update:search="collectionSearch = $event"
        @new-collection="openBuilder()"
        @launch-workflow="launchWorkflow"
        @edit-collection="openBuilderForEdit"
        @delete-collection="openDeleteCollectionDialog"
      />

      <EGSamplesTab
        v-else-if="activeTab === 'samples'"
        :lab-id="labId"
        :s3-configured="isLabS3Configured"
        :samples="samples"
        :tags="tags"
        :sample-id-to-tag-ids="sampleIdToTagIds"
        :sample-id-to-run-usages="sampleIdToRunUsages"
        :loading="loading"
        :selected-ids="selectedSampleIds"
        :search="sampleSearch"
        :tags-filter-untagged="tagsFilterUntagged"
        :tags-filter-tag-ids="tagsFilterTagIds"
        @update:selected-ids="selectedSampleIds = $event"
        @update:search="sampleSearch = $event"
        @update:tags-filter-untagged="tagsFilterUntagged = $event"
        @update:tags-filter-tag-ids="tagsFilterTagIds = $event"
        @import="openImport"
        @build-collection="openBuilder(selectedSampleIds)"
        @tags-updated="onSampleTagsUpdated"
        @tag-created="onSampleTagCreated"
        @tag-deleted="onSampleTagDeleted"
      />

      <EGUnlinkedFilesTab
        v-else
        :files="unlinkedFiles"
        :loading="loading"
        :selected-keys="selectedFileKeys"
        :search="fileSearch"
        :s3-configured="isLabS3Configured"
        :can-edit-lab-details="canEditLabDetails"
        :s3-bucket="unlinkedMeta.s3Bucket"
        :resolved-prefix="unlinkedMeta.resolvedPrefix"
        :last-scan-label="unlinkedMeta.lastScanLabel"
        @update:selected-keys="selectedFileKeys = $event"
        @update:search="fileSearch = $event"
        @rescan="loadUnlinkedFiles"
        @open-settings="openLabSettings"
        @build-sample="showBuildSampleModal = true"
        @group-with-regex="showRegexGroupModal = true"
      />
    </template>

    <EGBuildSampleModal
      v-model="showBuildSampleModal"
      :lab-id="labId"
      :lab="lab"
      :selected-keys="selectedFileKeys"
      @created="
        () => {
          selectedFileKeys = [];
          activeTab = 'samples';
          refreshAll();
        }
      "
    />

    <EGBuildSamplesFromRegexModal
      v-model="showRegexGroupModal"
      :lab-id="labId"
      :lab="lab"
      :file-keys="selectedFileKeys"
      @created="
        () => {
          selectedFileKeys = [];
          activeTab = 'samples';
          refreshAll();
        }
      "
    />

    <EGRunFromDataCollectionModal v-model="showRunModal" :lab-id="labId" :lab="lab" :data-collection="runCollection" />

    <EGDialog
      v-model="isDeleteCollectionDialogOpen"
      action-label="Delete collection"
      :action-variant="ButtonVariantEnum.enum.destructive"
      cancel-label="Cancel"
      :cancel-variant="ButtonVariantEnum.enum.secondary"
      :primary-message="deleteCollectionPrimaryMessage"
      :secondary-message="deleteCollectionSecondaryMessage"
      :loading="deleteCollectionBusy"
      :buttons-disabled="deleteCollectionBusy"
      @action-triggered="confirmDeleteCollection"
      @update:model-value="(open) => !open && closeDeleteCollectionDialog()"
    />
  </div>
</template>
