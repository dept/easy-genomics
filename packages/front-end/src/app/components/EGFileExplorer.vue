<script setup lang="ts">
  import { useDebounceFn } from '@vueuse/core';
  import type { TableSort } from './EGTable.vue';
  import type {
    S3Object,
    S3Response,
    S3TopLevelResponse,
    S3Prefix,
    RequestTopLevelBucketObjects,
    RequestSearchBucketObjects,
    S3SearchResponse,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
  import { formatCompactDateTime } from '@FE/utils/date-time';
  import { formatFileSize as formatBytes } from '@FE/utils/file-size';
  import { isS3BucketAccessDeniedError } from '@FE/utils/laboratory-s3';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';

  type S3SearchPrefix = S3Prefix;

  export type FileExplorerOutputFile = {
    Key: string;
    RelativePath: string;
    Label: string;
  };

  interface FileTreeNode {
    type?: 'file' | 'directory' | 'up' | string;
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
    outputLabel?: string;
    class?: string;
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
      /** Declared output files for this run — used for tags and the filter toggle. */
      outputFiles?: FileExplorerOutputFile[];
    }>(),
    { isLoading: true, outputFiles: () => [] },
  );

  const { handleS3Download, downloadFolder, openHtmlFromS3, isFolderZipInProgress } = useFileDownload();
  const { $api } = useNuxtApp();

  const uiStore = useUiStore();

  const ROOT_LABEL = 'Run folder';
  const currentPath = ref<FileTreeNode[]>([{ name: ROOT_LABEL, children: [] as FileTreeNode[] }]);
  const searchQuery = ref('');
  const searchResults = ref<FileTreeNode[]>([]);
  const isSearchLoading = ref(false);
  const searchRequestSeq = ref(0);
  const fileFilter = ref<'all' | 'outputs'>('all');
  const s3Bucket = props.s3Bucket;
  const s3Prefix = props.s3Prefix;
  const normalizedRootPrefix = computed(() => (s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`));

  const outputLabelByKey = computed(() => {
    const map = new Map<string, string>();
    for (const file of props.outputFiles) {
      map.set(file.Key, file.Label);
      // RelativePath match covers listings whose key is already relative to the run root.
      if (file.RelativePath) {
        map.set(file.RelativePath, file.Label);
        map.set(`${normalizedRootPrefix.value}${file.RelativePath}`, file.Label);
      }
    }
    return map;
  });

  function outputLabelFor(node: FileTreeNode): string | undefined {
    if (!node.s3Key && !node.name) return undefined;
    if (node.s3Key && outputLabelByKey.value.has(node.s3Key)) {
      return outputLabelByKey.value.get(node.s3Key);
    }
    if (node.s3Key?.startsWith(normalizedRootPrefix.value)) {
      const relative = node.s3Key.slice(normalizedRootPrefix.value.length);
      if (outputLabelByKey.value.has(relative)) return outputLabelByKey.value.get(relative);
    }
    return node.outputLabel;
  }

  const hasOpenedStartPath = ref(false);

  const isRootLoading = ref(true);

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
          outputLabel: outputLabelByKey.value.get(item.Key),
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
            .catch((error) => console.error('Pre-fetch failed for', childPrefix, error));
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
      useToastStore().error(
        isS3BucketAccessDeniedError(error)
          ? 'Access to this S3 bucket was revoked. Ask an organization admin to grant access, or set a new default bucket in lab settings.'
          : 'Failed to load folder contents',
      );
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
        .slice(1) // Skip run-folder root
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
      currentPath.value = [{ name: ROOT_LABEL, children: [] as FileTreeNode[] }];
      loadedDirectories.value.clear();
      searchQuery.value = '';
      searchResults.value = [];
      fileFilter.value = 'all';
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

  const outputOnlyItems = computed(() => {
    return props.outputFiles.map((file) => {
      const name = file.RelativePath.split('/').filter(Boolean).pop() || file.RelativePath;
      const node: FileTreeNode = {
        type: 'file',
        name,
        s3Key: file.Key,
        directoryPath: file.RelativePath.includes('/')
          ? file.RelativePath.split('/').slice(0, -1).join('/')
          : '',
        size: undefined,
        outputLabel: file.Label,
      };
      const uniqueString = nodeUniqueString(node);
      const downloadProgress = downloads.value[uniqueString];
      return {
        ...node,
        class: downloadProgress !== undefined ? `progress-bg-${downloadProgress}` : '',
      };
    });
  });

  const filteredItems = computed(() => {
    if (fileFilter.value === 'outputs' && !searchQuery.value.trim()) {
      return outputOnlyItems.value;
    }

    const source = searchQuery.value.trim() ? searchResults.value : currentItems.value;
    return source.map((node: FileTreeNode) => {
      const uniqueString = nodeUniqueString(node);
      const downloadProgress = downloads.value[uniqueString];
      return {
        ...node,
        outputLabel: outputLabelFor(node),
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

  const tableColumns = computed(() => [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      sort: (a: unknown, b: unknown, direction: 'asc' | 'desc') =>
        sortHelpers.stringSortCompare(String(a ?? ''), String(b ?? ''), direction),
    },
    {
      key: 'lastModified',
      label: 'Modified',
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
    { key: 'actions', label: '' },
  ]);

  const parentFolderName = computed(() => {
    if (currentPath.value.length < 2) return null;
    return currentPath.value[currentPath.value.length - 2]?.name ?? ROOT_LABEL;
  });

  const canDownloadCurrentFolder = computed(
    () => fileFilter.value === 'all' && !searchQuery.value.trim() && currentPath.value.length >= 1,
  );

  const fileTableSort = ref<TableSort>({ column: 'name', direction: 'asc' });

  const sortedTableData = computed(() => {
    const items = [...filteredItems.value];
    const { column, direction } = fileTableSort.value;
    const col = tableColumns.value.find((c) => c.key === column);
    if (!col || !('sortable' in col) || !col.sortable || typeof col.sort !== 'function') {
      // still attach up-row below
    } else {
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
    }

    if (
      fileFilter.value === 'all' &&
      !searchQuery.value.trim() &&
      parentFolderName.value &&
      currentPath.value.length > 1
    ) {
      items.unshift({
        type: 'up',
        name: `Up to ${parentFolderName.value}`,
      } as FileTreeNode & { class?: string });
    }

    return items;
  });

  const folderItemCountLabel = computed(() => {
    const n = sortedTableData.value.filter((row) => row.type !== 'up').length;
    if (fileFilter.value === 'outputs') {
      return n === 1 ? '1 output file' : `${n.toLocaleString()} output files`;
    }
    return n === 1 ? '1 file in this folder' : `${n.toLocaleString()} files in this folder`;
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
    return formatBytes(value);
  }

  // Helper to check if a value is a valid date string
  function isValidDate(date: string | undefined): boolean {
    if (!date) return false;
    const d = new Date(date);
    return !isNaN(d.getTime());
  }

  function formatModified(date: string | undefined): string {
    if (!isValidDate(date)) return '—';
    return formatCompactDateTime(date!) ?? '—';
  }

  const searchStatusMessage = computed(() => {
    const q = searchQuery.value.trim();
    if (!q) return '';
    if (isSearchLoading.value) return `Searching for "${q}"…`;
    const n = searchResults.value.length;
    if (n === 0) return `No results for "${q}"`;
    const noun = n === 1 ? 'result' : 'results';
    return `${n} search ${noun} for "${q}"`;
  });

  function onDirectoryKeydown(e: KeyboardEvent, row: FileTreeNode): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClicked(row);
    }
  }

  const onRowClicked = useDebounceFn((item: FileTreeNode) => {
    if (item.type === 'up') {
      navigateTo(currentPath.value.length - 2);
      return;
    }
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

    const pathSegments = breadcrumbs.value.map((crumb) => crumb.name).filter((name) => name !== ROOT_LABEL);
    return `s3://${s3Bucket}/${s3Prefix}/${pathSegments.join('/')}`;
  });

  async function downloadCurrentFolder(): Promise<void> {
    if (!canDownloadCurrentFolder.value) return;
    useToastStore().success('Your files have begun downloading');
    useAnalytics().track('file_browser_action', { action: 'download_folder' });
    await downloadFolder(props.labId, s3ObjectPath.value);
  }

  function nodeUniqueString(node: FileTreeNode): string {
    const childrenLen = Array.isArray(node.children) ? node.children.length : 0;
    return `${node.type}${node.s3Key || ''}${node.name}${node.size}${node.lastModified}${childrenLen}`;
  }

  function isHtmlFile(node: FileTreeNode): boolean {
    return node.type === 'file' && !!node.name?.toLowerCase().endsWith('.html');
  }

  async function navigateToSearchDirectory(node: FileTreeNode): Promise<void> {
    if (!node.s3Key) return;

    // Analytics: file browser navigation.
    useAnalytics().track('file_browser_action', { action: 'navigate' });

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
      useToastStore().error(
        isS3BucketAccessDeniedError(error)
          ? 'Access to this S3 bucket was revoked. Ask an organization admin to grant access, or set a new default bucket in lab settings.'
          : 'Failed to search files',
      );
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
      await openHtmlFromS3(props.labId, getNodeS3Uri(node));
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

    // Analytics: file browser action (file vs folder download).
    useAnalytics().track('file_browser_action', {
      action: node.type === 'file' ? 'download_file' : 'download_folder',
    });

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
  <section aria-label="File explorer" class="stroke-light rounded-2xl border border-solid bg-white p-6">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <EGSearchInput
        label="Search files in this run"
        class="min-w-[240px] flex-1"
        placeholder="Search files in this run."
        @input-event="(event: string) => (searchQuery = event)"
      />
      <div
        class="inline-flex rounded-lg border border-neutral-200 p-0.5"
        role="group"
        aria-label="File filter"
      >
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="
            fileFilter === 'all' ? 'bg-primary text-white' : 'text-body hover:bg-background-dark-grey bg-transparent'
          "
          :aria-pressed="fileFilter === 'all'"
          @click="fileFilter = 'all'"
        >
          All files
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="
            fileFilter === 'outputs'
              ? 'bg-primary text-white'
              : 'text-body hover:bg-background-dark-grey bg-transparent'
          "
          :aria-pressed="fileFilter === 'outputs'"
          :disabled="outputFiles.length === 0"
          @click="fileFilter = 'outputs'"
        >
          Output files only
        </button>
      </div>
    </div>

    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ searchStatusMessage }}</p>

    <div
      v-if="fileFilter === 'all'"
      class="mb-4 flex flex-wrap items-center justify-between gap-3"
    >
      <nav class="min-h-[24px]" aria-label="Folder path">
        <ol class="flex flex-wrap items-center gap-0">
          <li v-for="(crumb, index) in breadcrumbs" :key="index" class="flex items-center text-sm">
            <button
              v-if="index < breadcrumbs.length - 1"
              type="button"
              class="focus-visible:ring-primary-500 text-gray-500 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              @click="navigateTo(index)"
            >
              {{ crumb.name }}
            </button>
            <span v-else class="font-medium text-black" aria-current="page">{{ crumb.name }}</span>
            <span v-if="index < breadcrumbs.length - 1" class="separator mx-1 text-gray-400" aria-hidden="true">/</span>
          </li>
        </ol>
      </nav>
      <EGButton
        v-if="canDownloadCurrentFolder"
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        icon="i-heroicons-arrow-down-tray"
        :icon-right="false"
        label="Download this folder"
        :disabled="isFolderZipInProgress"
        @click="downloadCurrentFolder"
      />
    </div>

    <div v-if="isRootLoading" class="sr-only" role="status" aria-live="polite">Loading folder contents…</div>

    <EGTable
      :row-click-action="onRowClicked"
      :table-data="sortedTableData"
      v-model:sort="fileTableSort"
      :columns="tableColumns"
      no-results-msg="No files or folders found"
      :is-loading="isRootLoading || isSearchLoading"
      :show-pagination="false"
    >
      <template #name-data="{ row }">
        <div v-if="row.type === 'up'" class="flex items-center gap-2">
          <UIcon name="i-heroicons-arrow-left" class="text-muted h-4 w-4" aria-hidden="true" />
          <button
            type="button"
            class="focus-visible:ring-primary-500 text-primary text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            :aria-label="row.name"
            @click.stop="onRowClicked(row)"
          >
            {{ row.name }}
          </button>
        </div>
        <div v-else class="flex flex-wrap items-center gap-2">
          <UIcon
            :name="row.type === 'directory' ? 'i-heroicons-folder' : 'i-heroicons-document-text'"
            class="text-muted h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <button
            v-if="row.type === 'directory' && (!searchQuery.trim() || row.isSearchResult)"
            type="button"
            class="focus-visible:ring-primary-500 text-left font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            :aria-label="`Open folder ${row.name}`"
            @click.stop="onRowClicked(row)"
            @keydown="onDirectoryKeydown($event, row)"
          >
            {{ row.name }}
          </button>
          <span v-else class="font-medium text-black">{{ row.name }}</span>
          <span
            v-if="row.outputLabel"
            class="bg-primary-muted text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
          >
            Output file · {{ row.outputLabel }}
          </span>
          <span v-if="row.isLoading" class="text-xs text-gray-500" role="status">(loading…)</span>
        </div>
        <div v-if="row.isSearchResult && row.directoryPath" class="text-muted ml-6 text-xs">
          {{ row.directoryPath }}/
        </div>
        <div
          v-else-if="fileFilter === 'outputs' && row.directoryPath"
          class="text-muted ml-6 font-mono text-xs"
        >
          {{ row.directoryPath }}/{{ row.name }}
        </div>
      </template>
      <template #lastModified-data="{ row }">
        <span v-if="row.type !== 'up'">{{ formatModified(row.lastModified) }}</span>
      </template>
      <template #size-data="{ row }">
        <span v-if="row.type !== 'up'">{{ formatFileSize(row.size) }}</span>
      </template>
      <template #actions-data="{ row }">
        <div v-if="row.type !== 'up' && !(row.isSearchResult && row.type === 'directory')" class="flex justify-end gap-1">
          <button
            v-if="isHtmlFile(row)"
            type="button"
            class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg"
            :aria-label="`Open ${row.name}`"
            :disabled="uiStore.isRequestPending(`downloadHtmlFileButton-${nodeUniqueString(row)}`)"
            @click.stop="openHtmlInNewTab(row)"
          >
            <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-4 w-4" aria-hidden="true" />
          </button>
          <UTooltip
            :delay-duration="0"
            :prevent="!(row.type === 'directory' && isFolderZipInProgress)"
            :ui="{ base: 'h-full w-auto text-center' }"
          >
            <template #text>
              <span class="block text-balance">
                Another download is currently in progress. Please wait for it to finish before starting a new one.
              </span>
            </template>
            <button
              type="button"
              class="text-primary hover:text-primary-dark inline-flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-50"
              :aria-label="row.type === 'file' ? `Download ${row.name}` : `Download folder ${row.name}`"
              :disabled="
                downloadActive[nodeUniqueString(row)] === true ||
                (row.type === 'directory' &&
                  isFolderZipInProgress &&
                  !(downloads[nodeUniqueString(row)] !== undefined && downloads[nodeUniqueString(row)] < 100))
              "
              @click.stop="downloadFileTreeNode(row)"
            >
              <UIcon
                :name="
                  downloadActive[nodeUniqueString(row)] === true
                    ? 'i-heroicons-arrow-path'
                    : 'i-heroicons-arrow-down-tray'
                "
                class="h-4 w-4"
                :class="{ 'animate-spin': downloadActive[nodeUniqueString(row)] === true }"
                aria-hidden="true"
              />
            </button>
          </UTooltip>
        </div>
      </template>
    </EGTable>

    <p class="text-muted mt-3 text-xs">{{ folderItemCountLabel }}</p>
  </section>
</template>
