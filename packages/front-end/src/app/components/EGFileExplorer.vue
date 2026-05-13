<script setup lang="ts">
  import { useChangeCase } from '@vueuse/integrations/useChangeCase';
  import { useDebounceFn } from '@vueuse/core';
  import { format } from 'date-fns';
  import type { TableSort } from './EGTable.vue';
  import {
    S3Object,
    S3Response,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';
  import {
    S3TopLevelResponse,
    S3Prefix,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';
  import { RequestTopLevelBucketObjects } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';
  import {
    RequestSearchBucketObjects,
    S3Prefix as S3SearchPrefix,
    S3SearchResponse,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-search-bucket-objects';

  interface FileTreeNode {
    type?: string;
    name?: string;
    s3Key?: string;
    directoryPath?: string;
    isSearchResult?: boolean;
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
      runId?: string;
      s3Bucket: string;
      s3Prefix: string;
      s3Contents?: S3Response | null;
      isLoading?: boolean;
      startPath?: string[];
    }>(),
    { isLoading: true },
  );

  const { handleS3Download, downloadFolder, isFolderZipInProgress } = useFileDownload();
  const { $api } = useNuxtApp();

  const uiStore = useUiStore();

  const currentPath = ref<FileTreeNode[]>([{ name: 'All Files', children: [] as FileTreeNode[] }]);
  const searchQuery = ref('');
  const searchResults = ref<FileTreeNode[]>([]);
  const isSearchLoading = ref(false);
  const searchRequestSeq = ref(0);
  const s3Bucket = props.s3Bucket;
  const s3Prefix = props.s3Prefix;
  const normalizedRootPrefix = computed(() => (s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`));

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
          s3Key: item.Key,
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
              RunId: props.runId,
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
        RunId: props.runId,
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
      hasOpenedStartPath.value = false;
      currentPath.value = [{ name: 'All Files', children: [] as FileTreeNode[] }];
      loadedDirectories.value.clear();
      searchQuery.value = '';
      searchResults.value = [];
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
    if (!searchQuery.value.trim()) {
      return currentItems.value;
    }
    return searchResults.value.map((node: FileTreeNode) => {
      const uniqueString = nodeUniqueString(node);
      const downloadProgress = downloads.value[uniqueString];
      return {
        ...node,
        class: downloadProgress !== undefined ? `progress-bg-${downloadProgress}` : '',
      };
    });
  });

  const sortHelpers = useSort();

  /** Folders often have no lastModified; keep them after dated rows for a stable column sort. */
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

  const tableColumns = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      sort: (a: unknown, b: unknown, direction: 'asc' | 'desc') =>
        sortHelpers.stringSortCompare(String(a ?? ''), String(b ?? ''), direction),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      sort: (a: unknown, b: unknown, direction: 'asc' | 'desc') =>
        sortHelpers.stringSortCompare(String(a ?? ''), String(b ?? ''), direction),
    },
    {
      key: 'lastModified',
      label: 'Date Modified',
      sortable: true,
      sort: compareLastModified,
    },
    {
      key: 'size',
      label: 'Size',
      sortable: true,
      sort: (a: unknown, b: unknown, direction: 'asc' | 'desc') =>
        sortHelpers.numberSortCompare(Number(a ?? 0), Number(b ?? 0), direction),
    },
    { key: 'actions', label: 'Actions' },
  ];

  const fileTableSort = ref<TableSort>({ column: 'name', direction: 'asc' });

  const sortedTableData = computed(() => {
    const items = [...filteredItems.value];
    const { column, direction } = fileTableSort.value;
    const col = tableColumns.find((c) => c.key === column);
    if (!col || !('sortable' in col) || !col.sortable || typeof col.sort !== 'function') {
      return items;
    }

    const sortFn = col.sort as (a: unknown, b: unknown, direction: 'asc' | 'desc') => number;

    items.sort((rowA, rowB) => {
      const va = (rowA as Record<string, unknown>)[column];
      const vb = (rowB as Record<string, unknown>)[column];
      const cmp = sortFn(va, vb, direction);
      if (cmp !== 0) {
        return cmp;
      }
      return sortHelpers.stringSortCompare(String(rowA.name ?? ''), String(rowB.name ?? ''), direction);
    });

    return items;
  });

  // key is the uniqueString of a file tree node
  // value is the ref containing the progress of the download out of 100
  const downloads = ref<Record<string, Ref<number>>>({});
  // Tracks whether a given node is actively downloading (used for button loading state).
  // We keep this separate from `downloads[...]` so we can fade the green overlay without
  // showing the spinner forever.
  const downloadActive = ref<Record<string, boolean>>({});

  const fadeIntervals = new Map<string, ReturnType<typeof setInterval>>();

  function startFadeOutAndCleanup(uniqueString: string, progressRef: Ref<number>) {
    if (fadeIntervals.has(uniqueString)) return;

    // Keep it short: we only want to visually fade the green overlay.
    const fadeDurationMs = 700;
    const intervalMs = 50;
    const totalSteps = Math.ceil(fadeDurationMs / intervalMs);
    let step = 0;

    const timer = setInterval(() => {
      step += 1;
      const remainingSteps = Math.max(0, totalSteps - step);
      progressRef.value = Math.round((remainingSteps / totalSteps) * 100);

      if (step >= totalSteps) {
        const handle = fadeIntervals.get(uniqueString);
        if (handle) clearInterval(handle);
        fadeIntervals.delete(uniqueString);

        delete downloads.value[uniqueString];
        delete downloadActive.value[uniqueString];
      }
    }, intervalMs);

    fadeIntervals.set(uniqueString, timer);
  }

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
    if (searchQuery.value.trim()) {
      if (item.type === 'directory' && item.isSearchResult) {
        void navigateToSearchDirectory(item);
      }
      return;
    }
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
    return `${node.type}${node.s3Key || ''}${node.name}${node.size}${node.lastModified}${childrenLen}`;
  }

  function isHtmlFile(node: FileTreeNode): boolean {
    return node.type === 'file' && !!node.name?.toLowerCase().endsWith('.html');
  }

  async function navigateToSearchDirectory(node: FileTreeNode): Promise<void> {
    if (!node.s3Key) return;

    const relativePath = node.s3Key.startsWith(normalizedRootPrefix.value)
      ? node.s3Key.slice(normalizedRootPrefix.value.length)
      : node.s3Key;
    const directorySegments = relativePath.replace(/\/$/, '').split('/').filter(Boolean);
    if (directorySegments.length === 0) return;

    searchQuery.value = '';
    currentPath.value = [currentPath.value[0]];

    for (const segment of directorySegments) {
      const currentDir = currentPath.value[currentPath.value.length - 1];
      const children: FileTreeNode[] = Array.isArray(currentDir.children)
        ? currentDir.children
        : Object.values(currentDir.children || {});

      const targetDir = children.find((child) => child.type === 'directory' && child.name === segment);
      if (!targetDir) {
        useToastStore().error(`Could not open folder "${segment}"`);
        return;
      }

      await openDirectory(targetDir);
    }
  }

  function getNodeS3Uri(node: FileTreeNode): string {
    if (node.s3Key) {
      return `s3://${s3Bucket}/${node.s3Key}`;
    }

    if (node.type === 'file') {
      return `${s3ObjectPath.value}/${node.name}`;
    }

    return `${s3ObjectPath.value}/${node.name || ''}`;
  }

  function getNodeDirectoryPath(node: FileTreeNode): string {
    if (!node.s3Key) return s3ObjectPath.value;
    const keySegments = node.s3Key.split('/');
    keySegments.pop();
    return `s3://${s3Bucket}/${keySegments.join('/')}`;
  }

  const onSearchInput = useDebounceFn(async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      searchRequestSeq.value += 1;
      searchResults.value = [];
      isSearchLoading.value = false;
      return;
    }

    const requestId = ++searchRequestSeq.value;
    isSearchLoading.value = true;

    try {
      const response: S3SearchResponse = await $api.file.requestSearchBucketObjects({
        LaboratoryId: props.labId,
        S3Bucket: s3Bucket,
        S3Prefix: normalizedRootPrefix.value,
        SearchQuery: trimmedQuery,
        MaxResults: 200,
      } as RequestSearchBucketObjects);

      // Ignore stale responses from slower in-flight requests.
      if (requestId !== searchRequestSeq.value) return;

      const directoryResults: FileTreeNode[] = (response.CommonPrefixes || []).map((prefix: S3SearchPrefix) => {
        const relativePath = prefix.Prefix.startsWith(normalizedRootPrefix.value)
          ? prefix.Prefix.slice(normalizedRootPrefix.value.length)
          : prefix.Prefix;
        const trimmedRelativePath = relativePath.replace(/\/$/, '');
        const pathSegments = trimmedRelativePath.split('/').filter(Boolean);
        const folderName = pathSegments[pathSegments.length - 1] || trimmedRelativePath;
        const parentPath = pathSegments.slice(0, -1).join('/');

        return {
          type: 'directory',
          name: folderName,
          s3Key: prefix.Prefix,
          directoryPath: parentPath,
          isSearchResult: true,
          children: [],
        } as FileTreeNode;
      });

      const fileResults: FileTreeNode[] = (response.Contents || []).map((item) => {
        const relativePath = item.Key.startsWith(normalizedRootPrefix.value)
          ? item.Key.slice(normalizedRootPrefix.value.length)
          : item.Key;
        const pathSegments = relativePath.split('/');
        pathSegments.pop();

        return {
          type: 'file',
          name: item.Key.split('/').pop()!,
          s3Key: item.Key,
          directoryPath: pathSegments.join('/'),
          isSearchResult: true,
          size: item.Size,
          lastModified: item.LastModified,
        } as FileTreeNode;
      });

      searchResults.value = [...directoryResults, ...fileResults];
    } catch (error) {
      if (requestId !== searchRequestSeq.value) return;
      console.error('Error searching files in bucket:', error);
      useToastStore().error('Failed to search files');
      searchResults.value = [];
    } finally {
      if (requestId === searchRequestSeq.value) {
        isSearchLoading.value = false;
      }
    }
  }, 300);

  async function openHtmlInNewTab(node: FileTreeNode): Promise<void> {
    const nodeId = nodeUniqueString(node);
    uiStore.setRequestPending(`downloadHtmlFileButton-${nodeId}`);

    try {
      const fileDownloadPath = getNodeS3Uri(node);
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
    // If a fade-out is currently running for this node, stop it so the new download
    // starts from a clean slate.
    if (fadeIntervals.has(uniqueString)) {
      const handle = fadeIntervals.get(uniqueString);
      if (handle) clearInterval(handle);
      fadeIntervals.delete(uniqueString);
    }

    delete downloads.value[uniqueString];
    delete downloadActive.value[uniqueString];

    const progressRef: Ref<number> = ref(0);
    downloads.value[uniqueString] = progressRef;
    downloadActive.value[uniqueString] = true;

    useToastStore().success('Your files have begun downloading');

    try {
      if (node.type === 'file') {
        const fileName = node.s3Key?.split('/').pop() || node.name!;
        await handleS3Download(
          props.labId,
          fileName, // Filename
          getNodeDirectoryPath(node), // s3://{S3 Bucket}/{S3 Prefix} Path
          progressRef, // progress value ref to be updated by the function
        );
      } else {
        await downloadFolder(props.labId, getNodeS3Uri(node), progressRef);
      }
    } finally {
      // Ensure we briefly show "complete" and then fade the overlay out.
      progressRef.value = 100;
      downloadActive.value[uniqueString] = false;
      startFadeOutAndCleanup(uniqueString, progressRef);
    }
  }

  // Watchers to ensure data reactivity
  watch(currentPath, () => {});

  watch(searchQuery, (value: string) => {
    onSearchInput(value);
  });

  onBeforeUnmount(() => {
    fadeIntervals.forEach((handle) => clearInterval(handle));
    fadeIntervals.clear();
  });
</script>

<template>
  <div>
    <!-- Search input -->
    <EGSearchInput
      @input-event="(event: string) => (searchQuery = event)"
      placeholder="Search all files in bucket"
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
      :table-data="sortedTableData"
      v-model:sort="fileTableSort"
      :columns="tableColumns"
      no-results-msg="No files or folders found"
      :is-loading="isRootLoading || isSearchLoading"
    >
      <template #name-data="{ row }">
        <div class="flex items-center gap-2">
          <span
            v-if="row.type === 'directory' && (!searchQuery.trim() || row.isSearchResult)"
            class="underline hover:no-underline"
            @click="onRowClicked(row)"
          >
            {{ row.name }}/
          </span>
          <span v-else>
            {{ row.type === 'directory' ? `${row.name}/` : row.name }}
          </span>
          <span v-if="row.isLoading" class="text-xs text-gray-500">(loading...)</span>
        </div>
        <div v-if="row.isSearchResult && row.directoryPath" class="text-xs text-gray-500">{{ row.directoryPath }}/</div>
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
          <template v-if="!(row.isSearchResult && row.type === 'directory')">
            <!-- open in new tab -->
            <EGButton
              v-if="isHtmlFile(row)"
              variant="secondary"
              label="Open"
              :loading="uiStore.isRequestPending(`downloadHtmlFileButton-${nodeUniqueString(row)}`)"
              @click.stop="async () => await openHtmlInNewTab(row)"
            />

            <!-- download -->
            <UTooltip
              :delay-duration="0"
              :prevent="!isFolderZipInProgress"
              :ui="{
                base: 'h-full w-auto text-center',
              }"
            >
              <template #text>
                <span class="block text-balance">
                  Another download is currently in progress. Please wait for it to finish before starting a new one.
                </span>
              </template>
              <span class="inline-flex">
                <EGButton
                  variant="secondary"
                  :label="row?.type === 'file' ? 'Download' : 'Download as zip'"
                  :loading="downloadActive[nodeUniqueString(row)] === true"
                  :disabled="
                    row?.type === 'directory' &&
                    isFolderZipInProgress &&
                    !(downloads[nodeUniqueString(row)] !== undefined && downloads[nodeUniqueString(row)] < 100)
                  "
                  @click.stop="async () => await downloadFileTreeNode(row)"
                />
              </span>
            </UTooltip>
          </template>
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
