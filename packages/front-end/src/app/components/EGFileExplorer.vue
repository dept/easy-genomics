<script setup lang="ts">
  import { useChangeCase } from '@vueuse/integrations/useChangeCase';
  import { useDebounceFn } from '@vueuse/core';
  import { format } from 'date-fns';
  import {
    S3Object,
    S3Response,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';
  import {
    S3TopLevelResponse,
    S3Prefix,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';
  import { RequestTopLevelBucketObjects } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';

  interface FileTreeNode {
    type?: string;
    name?: string;
    size?: number;
    lastModified?: string;
    // children in the UI are arrays of FileTreeNode (nestify returns arrays).
    // Keep MapType only for the intermediate builder inside transformS3Data.
    children?: FileTreeNode[] | MapType;
    isLoading?: boolean; // Track if children are being loaded
  }

  interface MapType {
    [key: string]: FileTreeNode;
  }

  const props = withDefaults(
    defineProps<{
      labId: string;
      s3Bucket: string;
      s3Prefix: string;
      s3Contents?: S3Response | null;
      isLoading?: boolean;
      startPath?: string[];
    }>(),
    { isLoading: true },
  );

  const { handleS3Download, downloadFolder } = useFileDownload();
  const { $api } = useNuxtApp();

  const uiStore = useUiStore();

  const currentPath = ref<FileTreeNode[]>([{ name: 'All Files', children: [] as FileTreeNode[] }]);
  const searchQuery = ref('');
  const s3Bucket = props.s3Bucket;
  const s3Prefix = props.s3Prefix;

  const hasOpenedStartPath = ref(false);

  const isRootLoading = ref(false);

  // Cache for loaded directory contents to avoid re-fetching
  const loadedDirectories = ref<Map<string, FileTreeNode[]>>(new Map());

  /**
   * Transform a raw S3 API response into FileTreeNode children.
   * Kept separate so pre-fetch calls can use it without triggering further pre-fetches.
   */
  const transformS3Response = (response: S3TopLevelResponse): FileTreeNode[] => {
    const children: FileTreeNode[] = [];

    if (response.Contents) {
      response.Contents.forEach((item: S3Object) => {
        if (item.Key.endsWith('/')) return; // skip folder placeholder objects
        children.push({
          type: 'file',
          name: item.Key.split('/').pop()!,
          size: item.Size,
          lastModified: item.LastModified,
        });
      });
    }

    if (response.CommonPrefixes) {
      response.CommonPrefixes.forEach((prefix: S3Prefix) => {
        const folderName = prefix.Prefix.replace(/\/$/, '').split('/').pop()!;
        children.push({
          type: 'directory',
          name: folderName,
          children: [],
        });
      });
    }

    return children;
  };

  /**
   * Fire-and-forget pre-fetch for the next level of all subdirectories in `children`.
   * Called every time a directory's contents become visible so navigation is always instant.
   */
  const prefetchNextLevel = (children: FileTreeNode[], prefixPath: string): void => {
    children
      .filter((child) => child.type === 'directory')
      .forEach((child) => {
        const childPrefix = `${prefixPath}${child.name}/`;
        const childCacheKey = `${s3Bucket}::${childPrefix}`;
        if (!loadedDirectories.value.has(childCacheKey)) {
          $api.file
            .requestTopLevelBucketObjects({
              LaboratoryId: props.labId,
              S3Bucket: s3Bucket,
              S3Prefix: childPrefix,
            } as RequestTopLevelBucketObjects)
            .then((childResponse: S3TopLevelResponse) => {
              loadedDirectories.value.set(childCacheKey, transformS3Response(childResponse));
            })
            .catch(() => {}); // silently ignore pre-fetch errors
        }
      });
  };

  /**
   * Load children for a given prefix, with caching.
   */
  const loadDirectoryChildren = async (prefixPath: string): Promise<FileTreeNode[]> => {
    const cacheKey = `${s3Bucket}::${prefixPath}`;
    if (loadedDirectories.value.has(cacheKey)) {
      return loadedDirectories.value.get(cacheKey)!;
    }

    try {
      const response: S3TopLevelResponse = await $api.file.requestTopLevelBucketObjects({
        LaboratoryId: props.labId,
        S3Bucket: s3Bucket,
        S3Prefix: prefixPath,
      } as RequestTopLevelBucketObjects);

      const children = transformS3Response(response);
      loadedDirectories.value.set(cacheKey, children);
      prefetchNextLevel(children, prefixPath);
      return children;
    } catch (error) {
      console.error('Error loading directory children:', error);
      useToastStore().error('Failed to load folder contents');
      return [];
    }
  };

  /**
   * Initialize root directory on component mount
   */
  const initializeRoot = async () => {
    isRootLoading.value = true;
    try {
      const rootPath = s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`;
      const children = await loadDirectoryChildren(rootPath);
      currentPath.value[0].children = children;
    } finally {
      isRootLoading.value = false;
    }
  };

  /**
   * Handle opening a directory.
   * If the pre-fetch has already landed in cache, navigation is instant.
   * Only shows the loading indicator on a cache miss.
   */
  const openDirectory = async (dir: FileTreeNode) => {
    // Prevent opening the same directory twice
    const last = currentPath.value[currentPath.value.length - 1];
    if (last === dir) return;

    if (dir.type === 'directory' && (!dir.children || (Array.isArray(dir.children) && dir.children.length === 0))) {
      const pathSegments = currentPath.value
        .slice(1) // Skip "All Files"
        .map((node) => node.name)
        .concat([dir.name]);
      const fullPrefix = `${s3Prefix.endsWith('/') ? s3Prefix : s3Prefix + '/'}${pathSegments.join('/')}/`;
      const cacheKey = `${s3Bucket}::${fullPrefix}`;

      if (loadedDirectories.value.has(cacheKey)) {
        // Pre-fetch already completed — assign instantly, no spinner needed
        const children = loadedDirectories.value.get(cacheKey)!;
        dir.children = children;
        // Ensure the level below this one is also pre-fetched
        prefetchNextLevel(children, fullPrefix);
      } else {
        // Cache miss — show loading indicator and fetch (pre-fetch of next level
        // is triggered inside loadDirectoryChildren)
        dir.isLoading = true;
        const children = await loadDirectoryChildren(fullPrefix);
        dir.children = children;
        dir.isLoading = false;
      }
    }

    currentPath.value.push(dir);
  };

  // Initialize on mount and when props change
  onMounted(() => {
    initializeRoot();
  });

  watch(
    () => props.s3Prefix,
    async () => {
      currentPath.value = [{ name: 'All Files', children: [] as FileTreeNode[] }];
      loadedDirectories.value.clear();
      await initializeRoot();
    },
  );

  // Handle startPath navigation after root is loaded.
  // Awaits each openDirectory call so that multi-level paths (e.g. ['results', 'runId'])
  // navigate correctly: each level is fully fetched before descending into the next.
  watch(
    () => currentPath.value[0].children,
    async () => {
      if (hasOpenedStartPath.value) return;
      if (!props.startPath || props.startPath.length === 0) return;
      if (currentPath.value.length > 1) {
        hasOpenedStartPath.value = true;
        return;
      }

      hasOpenedStartPath.value = true;

      for (const step of props.startPath) {
        const currentDir = currentPath.value[currentPath.value.length - 1];
        const children: FileTreeNode[] = Array.isArray(currentDir.children)
          ? currentDir.children
          : Object.values(currentDir.children || {});

        const targetDir = children.find((node) => node.type === 'directory' && node.name === step);
        if (!targetDir) break;

        await openDirectory(targetDir);
      }
    },
  );

  const breadcrumbs = computed(() => {
    return currentPath.value.map((dir, index) => ({
      name: dir.name,
      path: currentPath.value.slice(0, index + 1),
    }));
  });

  const currentItems = computed(() => {
    const currentDir = currentPath.value[currentPath.value.length - 1];
    const items = currentDir.children || [];

    // Normalize items to array if it's a MapType object
    const itemsArray: FileTreeNode[] = Array.isArray(items) ? items : Object.values(items);

    // add in download progress class
    return itemsArray.map((node: FileTreeNode) => {
      const uniqueString = nodeUniqueString(node);
      const downloadProgress = downloads.value[uniqueString];

      return {
        ...node,
        class: downloadProgress !== undefined ? `progress-bg-${downloadProgress}` : '',
      };
    });
  });

  const filteredItems = computed(() => {
    const query = searchQuery.value.toLowerCase();
    return currentItems.value.filter((item: FileTreeNode) => (item?.name || '').toLowerCase().includes(query));
  });

  const tableColumns = [
    { key: 'name', label: 'Name', sortable: true, sort: useSort().stringSortCompare },
    { key: 'type', label: 'Type', sortable: true, sort: useSort().stringSortCompare },
    {
      key: 'lastModified',
      label: 'Date Modified',
      sortable: true,
      sort: useSort().dateSortCompare,
    },
    { key: 'size', label: 'Size', sortable: true, sort: useSort().numberSortCompare },
    { key: 'actions', label: 'Actions' },
  ];

  // key is the uniqueString of a file tree node
  // value is the ref containing the progress of the download out of 100
  const downloads = ref<Record<string, Ref<number>>>({});

  function formatFileSize(value?: number): string {
    if (!value) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  }

  // Helper to check if a value is a valid date string
  function isValidDate(date: string | undefined): boolean {
    if (!date) return false;
    const d = new Date(date);
    return !isNaN(d.getTime());
  }

  const onRowClicked = useDebounceFn((item: FileTreeNode) => {
    if (item.type === 'directory') {
      openDirectory(item);
    }
  }, 300);

  const navigateTo = (index: number) => {
    if (index >= 0 && index < currentPath.value.length) {
      currentPath.value = currentPath.value.slice(0, index + 1);
    }
  };

  const s3ObjectPath = computed(() => {
    if (breadcrumbs.value?.length <= 1) {
      return `s3://${s3Bucket}/${s3Prefix}`;
    }

    const pathSegments = breadcrumbs.value.map((crumb) => crumb.name).filter((name) => name !== 'All Files');
    return `s3://${s3Bucket}/${s3Prefix}/${pathSegments.join('/')}`;
  });

  function nodeUniqueString(node: FileTreeNode): string {
    const childrenLen = Array.isArray(node.children) ? node.children.length : 0;
    return `${node.type}${node.name}${node.size}${node.lastModified}${childrenLen}`;
  }

  function isHtmlFile(node: FileTreeNode): boolean {
    return node.type === 'file' && !!node.name?.toLowerCase().endsWith('.html');
  }

  async function openHtmlInNewTab(node: FileTreeNode): Promise<void> {
    const nodeId = nodeUniqueString(node);
    uiStore.setRequestPending(`downloadHtmlFileButton-${nodeId}`);

    try {
      const fileDownloadPath = `${s3ObjectPath.value}/${node.name}`;
      const fileDownloadResponse = await $api.file.requestFileDownloadUrl({
        LaboratoryId: props.labId,
        S3Uri: fileDownloadPath,
      });

      if (!fileDownloadResponse || !fileDownloadResponse.DownloadUrl) {
        console.error('Download URL is undefined or empty');
        return;
      }

      // Fetch the HTML content
      const response = await fetch(fileDownloadResponse.DownloadUrl);
      const htmlContent = await response.text();

      // Create a new blob with the HTML content and proper MIME type
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);

      // Open the blob URL in a new tab
      window.open(blobUrl, '_blank');
    } catch (error) {
      console.error('Error opening HTML file:', error);
      useToastStore().error('Failed to open HTML file');
    } finally {
      uiStore.setRequestComplete(`downloadHtmlFileButton-${nodeId}`);
    }
  }

  async function downloadFileTreeNode(node: FileTreeNode): Promise<void> {
    const uniqueString = nodeUniqueString(node);
    const progressRef: Ref<number> = ref(0);
    downloads.value[uniqueString] = progressRef;

    useToastStore().success('Your files have begun downloading');

    if (node.type === 'file') {
      await handleS3Download(
        props.labId,
        node.name!, // Filename
        s3ObjectPath.value, // s3://{S3 Bucket}/{S3 Prefix} Path
        progressRef, // progress value ref to be updated by the function
      );
    } else {
      // Build the full S3 URI for the folder: current path + folder name
      const folderS3Uri = `${s3ObjectPath.value}/${node.name}`;
      await downloadFolder(props.labId, folderS3Uri, node.name!, progressRef);
    }
  }

  // Watchers to ensure data reactivity
  watch(currentPath, () => {});
</script>

<template>
  <div>
    <!-- Search input -->
    <EGSearchInput
      @input-event="(event: string) => (searchQuery = event)"
      placeholder="Search files/folders"
      class="mb-6 w-[408px]"
    />

    <!-- Breadcrumbs -->
    <div class="mb-6 flex min-h-[24px] flex-wrap">
      <span
        v-for="(crumb, index) in breadcrumbs"
        :key="index"
        @click="navigateTo(index)"
        class="breadcrumb-item text-sm"
        :class="{ 'text-black': index === breadcrumbs.length - 1, 'text-gray-500': index !== breadcrumbs.length - 1 }"
      >
        {{ crumb.name }}
        <i v-if="index < breadcrumbs.length - 1" class="separator">/</i>
      </span>
    </div>

    <EGTable
      :row-click-action="onRowClicked"
      :table-data="filteredItems"
      :columns="tableColumns"
      no-results-msg="No files or folders found"
      :is-loading="isRootLoading"
    >
      <template #name-data="{ row }">
        <div class="flex items-center gap-2">
          <span v-if="row.type === 'directory'" class="underline hover:no-underline" @click="onRowClicked(row)">
            {{ row.name }}/
          </span>
          <span v-else>
            {{ row.name }}
          </span>
          <span v-if="row.isLoading" class="text-xs text-gray-500">(loading...)</span>
        </div>
      </template>
      <template #type-data="{ row }">
        {{ useChangeCase(row.type === 'directory' ? 'Folder' : row.type, 'sentenceCase') }}
      </template>
      <template #lastModified-data="{ row }">
        <span v-if="isValidDate(row.lastModified)">
          {{ format(new Date(row.lastModified), 'MM/dd/yyyy') }}
        </span>
        <span v-else>—</span>
      </template>
      <template #size-data="{ row }">
        {{ formatFileSize(row.size) }}
      </template>
      <template #actions-data="{ row }">
        <div class="flex justify-end gap-4">
          <!-- open in new tab -->
          <EGButton
            v-if="isHtmlFile(row)"
            variant="secondary"
            label="Open"
            :loading="uiStore.isRequestPending(`downloadHtmlFileButton-${nodeUniqueString(row)}`)"
            @click.stop="async () => await openHtmlInNewTab(row)"
          />

          <!-- download -->
          <EGButton
            variant="secondary"
            :label="row?.type === 'file' ? 'Download' : 'Download as zip'"
            :loading="downloads[nodeUniqueString(row)] !== undefined && downloads[nodeUniqueString(row)] < 100"
            @click.stop="async () => await downloadFileTreeNode(row)"
          />
        </div>
      </template>
    </EGTable>
  </div>
</template>

<style scoped>
  .breadcrumb-item {
    cursor: pointer;
    margin-right: 5px;
    display: flex;
    align-items: center;

    &:last-child {
      cursor: default;
    }

    .separator {
      margin: 0 2px 0 3px;
    }
  }
</style>
