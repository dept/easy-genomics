<script setup lang="ts">
  import type {
    RequestSearchBucketObjects,
    S3Object,
    S3Prefix,
    S3SearchResponse,
    S3TopLevelResponse,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
  import {
    WORKFLOW_KEY_OUTPUT_DESCRIPTION_MAX_LENGTH,
    WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import { inferKeyOutputLabel } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { formatFileSize as formatBytes } from '@FE/utils/file-size';
  import { useToastStore, useUiStore, useWorkflowKeyOutputsStore } from '@FE/stores';
  import { v4 as uuidv4 } from 'uuid';

  export type FileTreeOutputFile = {
    Key: string;
    RelativePath: string;
    Label: string;
  };

  type TreeNode = {
    id: string;
    type: 'file' | 'directory';
    name: string;
    /** Absolute S3 key or prefix (directories end with /). */
    s3Key: string;
    /** Path relative to the run root. */
    relativePath: string;
    size?: number;
    fileCount?: number;
    totalSize?: number;
    children?: TreeNode[];
    isLoading?: boolean;
    outputLabel?: string;
  };

  type PendingMark = {
    pathKey: string;
    s3Key: string;
    relativePath: string;
    pattern: string;
    label: string;
    description: string;
    examplePath?: string;
    keyOutputId?: string;
    isFolder: boolean;
    fileCount?: number;
  };

  const props = withDefaults(
    defineProps<{
      labId: string;
      runId?: string;
      s3Bucket: string;
      s3Prefix: string;
      outputFiles?: FileTreeOutputFile[];
      markMode?: boolean;
      sampleCount?: number | null;
      canMarkResults?: boolean;
      workflowId?: string | null;
      workflowName?: string | null;
      labName?: string | null;
    }>(),
    {
      outputFiles: () => [],
      markMode: false,
      sampleCount: null,
      canMarkResults: false,
      labName: null,
    },
  );

  const emit = defineEmits<{
    'update:markMode': [value: boolean];
    marked: [];
  }>();

  const { $api } = useNuxtApp();
  const { handleS3Download, downloadFolder, openHtmlFromS3, isFolderZipInProgress } = useFileDownload();
  const uiStore = useUiStore();
  const toast = useToastStore();
  const keyOutputsStore = useWorkflowKeyOutputsStore();
  const listing = useS3BucketListing({
    labId: () => props.labId,
    s3Bucket: () => props.s3Bucket,
    runId: () => props.runId,
  });

  const normalizedRootPrefix = computed(() => (props.s3Prefix.endsWith('/') ? props.s3Prefix : `${props.s3Prefix}/`));
  const rootChildren = ref<TreeNode[]>([]);
  const expandedIds = ref<Set<string>>(new Set());
  const focusedIndex = ref(0);
  const draftMarks = ref<Map<string, PendingMark>>(new Map());
  const isRootLoading = ref(true);
  const isExpandingAll = ref(false);
  const isPersistingMarks = ref(false);
  const isMarkModalOpen = ref(false);
  const isMarkModalBusy = ref(false);
  const markModalNode = ref<TreeNode | null>(null);
  const markModalName = ref('');
  const markModalDescription = ref('');
  const isUnmarkDialogOpen = ref(false);
  const isUnmarkBusy = ref(false);
  const unmarkTarget = ref<PendingMark | null>(null);
  const searchQuery = ref('');
  const searchResults = ref<TreeNode[]>([]);
  const isSearchLoading = ref(false);
  const searchRequestSeq = ref(0);
  const listEl = ref<HTMLElement | null>(null);
  /** Transformed TreeNode children keyed like the shared listing cache. */
  const treeChildrenCache = ref<Map<string, TreeNode[]>>(new Map());

  const outputLabelByKey = computed(() => {
    const map = new Map<string, string>();
    for (const file of props.outputFiles) {
      map.set(file.Key, file.Label);
      if (file.RelativePath) {
        map.set(file.RelativePath, file.Label);
        map.set(`${normalizedRootPrefix.value}${file.RelativePath}`, file.Label);
      }
    }
    return map;
  });

  function outputLabelFor(node: TreeNode): string | undefined {
    return outputLabelByKey.value.get(node.s3Key) || outputLabelByKey.value.get(node.relativePath) || node.outputLabel;
  }

  /**
   * Folder badge only when every file under this path is a marked match.
   * Partial marks stay on the files themselves — do not bubble to ancestors.
   */
  function folderOutputLabel(relativePath: string, fileCount?: number): string | undefined {
    if (fileCount == null || fileCount <= 0) return undefined;
    const prefix = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
    const under = props.outputFiles.filter(
      (file) => file.RelativePath === relativePath || file.RelativePath.startsWith(prefix),
    );
    if (under.length < fileCount) return undefined;
    return under[0]?.Label;
  }

  function transformResponse(response: S3TopLevelResponse, parentRelative: string): TreeNode[] {
    const children: TreeNode[] = [];
    if (response.Contents) {
      response.Contents.forEach((item: S3Object) => {
        if (item.Key.endsWith('/')) return;
        const name = item.Key.split('/').pop()!;
        const relativePath = parentRelative ? `${parentRelative}${name}` : name;
        children.push({
          id: item.Key,
          type: 'file',
          name,
          s3Key: item.Key,
          relativePath,
          size: item.Size,
          outputLabel: outputLabelByKey.value.get(item.Key) || outputLabelByKey.value.get(relativePath),
        });
      });
    }
    if (response.CommonPrefixes) {
      response.CommonPrefixes.forEach((prefix: S3Prefix) => {
        const folderName = prefix.Prefix.replace(/\/$/, '').split('/').pop()!;
        const relativePath = parentRelative ? `${parentRelative}${folderName}` : folderName;
        children.push({
          id: prefix.Prefix,
          type: 'directory',
          name: folderName,
          s3Key: prefix.Prefix,
          relativePath,
          children: [],
          outputLabel: undefined,
        });
      });
    }
    return children;
  }

  function treeCacheKey(prefix: string): string {
    return `${props.s3Bucket}::${prefix}`;
  }

  async function loadChildren(prefix: string, parentRelative: string): Promise<TreeNode[]> {
    const key = treeCacheKey(prefix);
    if (treeChildrenCache.value.has(key)) {
      return treeChildrenCache.value.get(key)!;
    }
    const response = await listing.fetchTopLevel(prefix);
    const children = transformResponse(response, parentRelative ? `${parentRelative}/` : '');
    const next = new Map(treeChildrenCache.value);
    next.set(key, children);
    treeChildrenCache.value = next;
    void prefetchStats(children, prefix);
    return children;
  }

  async function prefetchStats(children: TreeNode[], parentPrefix: string): Promise<void> {
    const dirs = children.filter((child) => child.type === 'directory');
    if (!dirs.length) return;
    await Promise.all(
      dirs.map(async (dir) => {
        const childPrefix = `${parentPrefix}${dir.name}/`;
        const stats = await listing.fetchFolderStats(childPrefix);
        dir.fileCount = stats.fileCount;
        dir.totalSize = stats.totalSize;
        // Warm the next listing level so expand is instant.
        void listing.fetchTopLevel(childPrefix).then((response) => {
          const key = treeCacheKey(childPrefix);
          if (treeChildrenCache.value.has(key)) return;
          const next = new Map(treeChildrenCache.value);
          next.set(key, transformResponse(response, `${dir.relativePath}/`));
          treeChildrenCache.value = next;
        });
      }),
    );
    // Rows are shallow copies — retarget root so FILES/SIZE refresh after prefetch.
    rootChildren.value = rootChildren.value.slice();
  }

  async function initializeRoot(): Promise<void> {
    isRootLoading.value = true;
    try {
      rootChildren.value = await loadChildren(normalizedRootPrefix.value, '');
    } finally {
      isRootLoading.value = false;
    }
  }

  onMounted(() => {
    void initializeRoot();
  });

  watch(
    () => props.s3Prefix,
    async () => {
      expandedIds.value = new Set();
      draftMarks.value = new Map();
      listing.clearCache();
      treeChildrenCache.value = new Map();
      searchQuery.value = '';
      searchResults.value = [];
      await initializeRoot();
    },
  );

  function findNodeById(nodes: TreeNode[], id: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children?.length) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** visibleRows spreads nodes into copies — always mutate the tree node, never the row. */
  async function ensureChildrenLoaded(node: TreeNode): Promise<void> {
    if (node.type !== 'directory') return;
    const prefix = node.s3Key.endsWith('/') ? node.s3Key : `${node.s3Key}/`;
    const key = treeCacheKey(prefix);
    if (!node.children?.length) {
      if (treeChildrenCache.value.has(key)) {
        node.children = treeChildrenCache.value.get(key)!;
      } else {
        node.isLoading = true;
        try {
          node.children = await loadChildren(prefix, node.relativePath);
        } finally {
          node.isLoading = false;
        }
      }
    }
    const stats = await listing.fetchFolderStats(prefix);
    node.fileCount = stats.fileCount;
    node.totalSize = stats.totalSize;
  }

  async function toggleExpand(row: TreeNode): Promise<void> {
    const node = findNodeById(rootChildren.value, row.id);
    if (!node || node.type !== 'directory') return;
    if (expandedIds.value.has(node.id)) {
      const next = new Set(expandedIds.value);
      next.delete(node.id);
      expandedIds.value = next;
      return;
    }
    await ensureChildrenLoaded(node);
    const next = new Set(expandedIds.value);
    next.add(node.id);
    expandedIds.value = next;
  }

  function flattenVisible(nodes: TreeNode[], depth = 0): Array<TreeNode & { depth: number }> {
    const rows: Array<TreeNode & { depth: number }> = [];
    for (const node of nodes) {
      const folderLabel =
        node.type === 'directory' ? folderOutputLabel(node.relativePath, node.fileCount) : undefined;
      rows.push({ ...node, depth, outputLabel: outputLabelFor(node) || folderLabel });
      if (node.type === 'directory' && expandedIds.value.has(node.id) && node.children?.length) {
        rows.push(...flattenVisible(node.children, depth + 1));
      }
    }
    return rows;
  }

  const visibleRows = computed(() => {
    if (searchQuery.value.trim()) return searchResults.value.map((node) => ({ ...node, depth: 0 }));
    return flattenVisible(rootChildren.value);
  });

  const footerLabel = computed(() => {
    const fileCount = countAllFiles(rootChildren.value);
    const totalSize = sumAllSizes(rootChildren.value);
    const parts = [
      `${fileCount.toLocaleString()} ${fileCount === 1 ? 'file' : 'files'}`,
      formatBytes(totalSize) || null,
      props.sampleCount != null ? `${props.sampleCount.toLocaleString()} samples` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });

  function countAllFiles(nodes: TreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === 'file') count += 1;
      else if (node.fileCount != null) count += node.fileCount;
      else if (node.children?.length) count += countAllFiles(node.children);
    }
    return count;
  }

  function sumAllSizes(nodes: TreeNode[]): number {
    let total = 0;
    for (const node of nodes) {
      if (node.type === 'file') total += node.size ?? 0;
      else if (node.totalSize != null) total += node.totalSize;
      else if (node.children?.length) total += sumAllSizes(node.children);
    }
    return total;
  }

  const downloadRootLabel = computed(() => {
    const size = formatBytes(sumAllSizes(rootChildren.value));
    return size ? `Download run folder · ${size}` : 'Download run folder';
  });

  const hasExpandedFolders = computed(() => expandedIds.value.size > 0);

  function collapseAll(): void {
    expandedIds.value = new Set();
  }

  async function expandAll(): Promise<void> {
    if (isExpandingAll.value) return;
    isExpandingAll.value = true;
    try {
      const queue = [...rootChildren.value.filter((n) => n.type === 'directory')];
      const concurrency = 3;
      const toExpand = new Set<string>(expandedIds.value);
      while (queue.length) {
        const batch = queue.splice(0, concurrency);
        await Promise.all(
          batch.map(async (node) => {
            await ensureChildrenLoaded(node);
            toExpand.add(node.id);
            for (const child of node.children ?? []) {
              if (child.type === 'directory') queue.push(child);
            }
          }),
        );
      }
      // One write — concurrent Set copies were dropping sibling expands.
      expandedIds.value = toExpand;
    } finally {
      isExpandingAll.value = false;
    }
  }

  async function toggleExpandCollapseAll(): Promise<void> {
    if (hasExpandedFolders.value) {
      collapseAll();
      return;
    }
    await expandAll();
  }

  function pathKeyFor(node: TreeNode): string {
    if (node.type === 'directory') {
      return node.relativePath.endsWith('/') ? node.relativePath : `${node.relativePath}/`;
    }
    return node.relativePath;
  }

  function seedDraftFromDefinition(): void {
    if (!props.workflowId) {
      draftMarks.value = new Map();
      return;
    }
    const definition = keyOutputsStore.definitionFor(props.labId, props.workflowId);
    const next = new Map<string, PendingMark>();
    for (const item of definition?.KeyOutputs ?? []) {
      // Folder roles are stored as `dir/*` (or legacy `dir/`); tree checkboxes use `dir/`.
      const isFolder = item.Pattern.endsWith('/*') || item.Pattern.endsWith('/');
      const pattern = item.Pattern.endsWith('/') ? `${item.Pattern.replace(/\/+$/, '')}/*` : item.Pattern;
      const pathKey = isFolder
        ? pattern.endsWith('/*')
          ? pattern.slice(0, -1)
          : pattern
        : item.ExamplePath || item.Pattern;
      next.set(pathKey, {
        pathKey,
        s3Key: `${normalizedRootPrefix.value}${pathKey}`,
        relativePath: pathKey.replace(/\/$/, ''),
        pattern,
        label: item.Label,
        description: item.Description ?? '',
        examplePath: item.ExamplePath,
        keyOutputId: item.KeyOutputId,
        isFolder,
      });
    }
    draftMarks.value = next;
  }

  /** Role covering this row — exact path, parent folder role, or run-match for a pattern. */
  function markCoveringNode(node: TreeNode): PendingMark | undefined {
    const pathKey = pathKeyFor(node);
    const direct = draftMarks.value.get(pathKey);
    if (direct) return direct;

    for (const mark of draftMarks.value.values()) {
      if (!mark.isFolder) continue;
      if (pathKey === mark.pathKey || pathKey.startsWith(mark.pathKey)) return mark;
    }

    if (!props.runId) return undefined;
    const matches = keyOutputsStore.matchesFor(props.labId, props.runId);
    const role = matches?.KeyOutputs.find((item) =>
      item.Matches.some((file) => file.RelativePath === node.relativePath || file.Key === node.s3Key),
    );
    if (!role) return undefined;
    return [...draftMarks.value.values()].find((mark) => mark.keyOutputId === role.KeyOutputId);
  }

  function isSelected(node: TreeNode): boolean {
    return !!markCoveringNode(node);
  }

  const markBannerText = computed(() => {
    const workflow = props.workflowName?.trim() || 'this workflow';
    const lab = props.labName?.trim() || 'this laboratory';
    return `Marking results. Tick a file or folder to add it to Selected results. Ticking a sample's file can cover that file for every sample. Changes show on every run of ${workflow} for ${lab}.`;
  });

  const markModalSubtitle = computed(() => {
    const node = markModalNode.value;
    if (!node) return '';
    if (node.type === 'directory') {
      const count = node.fileCount;
      if (count != null) {
        return `The whole folder, ${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}, downloads as one zip.`;
      }
      return 'The whole folder, downloads as one zip.';
    }
    const size = formatBytes(node.size);
    return size ? `1 file · ${size}` : '1 file';
  });

  const unmarkDialogSecondary = computed(() => {
    const mark = unmarkTarget.value;
    if (!mark) return '';
    return mark.label
      ? `This removes “${mark.label}” from Selected results for every run of this workflow.`
      : 'This removes the selected result for every run of this workflow.';
  });

  function openMarkModal(node: TreeNode): void {
    markModalNode.value = node;
    const existing = draftMarks.value.get(pathKeyFor(node));
    markModalName.value = existing?.label || inferKeyOutputLabel(pathKeyFor(node)) || node.name;
    markModalDescription.value = existing?.description || '';
    isMarkModalOpen.value = true;
  }

  function closeMarkModal(): void {
    isMarkModalOpen.value = false;
    markModalNode.value = null;
    markModalName.value = '';
    markModalDescription.value = '';
    isMarkModalBusy.value = false;
  }

  function closeUnmarkDialog(): void {
    if (isUnmarkBusy.value) return;
    isUnmarkDialogOpen.value = false;
    unmarkTarget.value = null;
  }

  function onCheckboxClick(node: TreeNode): void {
    const covering = markCoveringNode(node);
    if (covering) {
      unmarkTarget.value = covering;
      isUnmarkDialogOpen.value = true;
      return;
    }
    openMarkModal(node);
  }

  async function persistMarks(next: Map<string, PendingMark>, successMessage: string): Promise<boolean> {
    if (!props.workflowId || !props.runId) return false;
    const saved = await keyOutputsStore.save(
      props.labId,
      props.workflowId,
      [...next.values()].map((mark) => ({
        KeyOutputId: mark.keyOutputId,
        Label: mark.label.trim(),
        Description: mark.description.trim() || undefined,
        Pattern: mark.pattern.trim(),
        ExamplePath: mark.examplePath,
      })),
      {
        WorkflowName: props.workflowName ?? undefined,
        Platform: 'AWS HealthOmics',
        SourceRunId: props.runId,
      },
    );
    if (!saved) return false;
    draftMarks.value = next;
    toast.success(successMessage);
    emit('marked');
    return true;
  }

  async function confirmMarkModal(): Promise<void> {
    const node = markModalNode.value;
    if (!node || !props.runId || !markModalName.value.trim()) return;
    isMarkModalBusy.value = true;
    isPersistingMarks.value = true;
    try {
      // Directory S3 keys end with `/`; preview rejects those — strip so folders become `dir/*`.
      const previewKey = node.s3Key.replace(/\/+$/, '');
      const previewed = await keyOutputsStore.preview(props.labId, props.runId, { ObjectKeys: [previewKey] });
      if (!previewed?.length) {
        toast.error('Could not infer a pattern for this selection.');
        return;
      }
      const inferred = previewed[0];
      const pathKey = pathKeyFor(node);
      const next = new Map(draftMarks.value);
      next.set(pathKey, {
        pathKey,
        s3Key: node.s3Key,
        relativePath: node.relativePath,
        pattern: inferred.Pattern,
        label: markModalName.value.trim(),
        description: markModalDescription.value.trim(),
        examplePath: inferred.ExamplePath || pathKey,
        keyOutputId: draftMarks.value.get(pathKey)?.keyOutputId || uuidv4(),
        isFolder: node.type === 'directory',
        fileCount: node.fileCount,
      });
      const saved = await persistMarks(next, 'Selected results updated.');
      if (saved) closeMarkModal();
    } finally {
      isMarkModalBusy.value = false;
      isPersistingMarks.value = false;
    }
  }

  async function confirmUnmark(): Promise<void> {
    const mark = unmarkTarget.value;
    if (!mark) return;
    isUnmarkBusy.value = true;
    isPersistingMarks.value = true;
    try {
      const next = new Map(draftMarks.value);
      next.delete(mark.pathKey);
      const saved = await persistMarks(next, 'Selected result removed.');
      if (saved) {
        isUnmarkDialogOpen.value = false;
        unmarkTarget.value = null;
      }
    } finally {
      isUnmarkBusy.value = false;
      isPersistingMarks.value = false;
    }
  }

  function exitMarkMode(): void {
    closeMarkModal();
    closeUnmarkDialog();
    emit('update:markMode', false);
  }

  function enterMarkMode(): void {
    seedDraftFromDefinition();
    emit('update:markMode', true);
  }

  watch(
    () => props.markMode,
    (enabled) => {
      if (enabled) seedDraftFromDefinition();
      else {
        draftMarks.value = new Map();
        closeMarkModal();
        closeUnmarkDialog();
      }
    },
    // Mounts with markMode=true (Mark more / declareKeyOutputs) must seed existing roles.
    { immediate: true },
  );

  async function downloadRoot(): Promise<void> {
    const uri = `s3://${props.s3Bucket}/${props.s3Prefix}`;
    toast.success('Your files have begun downloading');
    await downloadFolder(props.labId, uri);
  }

  async function downloadNode(node: TreeNode): Promise<void> {
    toast.success('Your files have begun downloading');
    if (node.type === 'file') {
      const parent = node.s3Key.includes('/')
        ? `s3://${props.s3Bucket}/${node.s3Key.split('/').slice(0, -1).join('/')}`
        : `s3://${props.s3Bucket}`;
      await handleS3Download(props.labId, node.name, parent);
      return;
    }
    await downloadFolder(props.labId, `s3://${props.s3Bucket}/${node.s3Key}`);
  }

  async function openHtml(node: TreeNode): Promise<void> {
    const requestId = `openTreeHtml-${node.id}`;
    uiStore.setRequestPending(requestId);
    try {
      await openHtmlFromS3(props.labId, `s3://${props.s3Bucket}/${node.s3Key}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to open HTML file');
    } finally {
      uiStore.setRequestComplete(requestId);
    }
  }

  function isHtml(node: TreeNode): boolean {
    return node.type === 'file' && !!node.name.toLowerCase().endsWith('.html');
  }

  function onKeydown(event: KeyboardEvent): void {
    const rows = visibleRows.value;
    if (!rows.length) return;
    const max = rows.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusedIndex.value = Math.min(max, focusedIndex.value + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusedIndex.value = Math.max(0, focusedIndex.value - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusedIndex.value = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      focusedIndex.value = max;
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const row = rows[focusedIndex.value];
      if (row?.type === 'directory' && !expandedIds.value.has(row.id)) void toggleExpand(row);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const row = rows[focusedIndex.value];
      if (!row) return;
      if (row.type === 'directory' && expandedIds.value.has(row.id)) {
        void toggleExpand(row);
        return;
      }
      // Close the containing folder and move focus to it.
      if (row.depth > 0) {
        for (let i = focusedIndex.value - 1; i >= 0; i -= 1) {
          if (rows[i].depth === row.depth - 1) {
            const parent = rows[i];
            if (parent.type === 'directory' && expandedIds.value.has(parent.id)) {
              void toggleExpand(parent);
            }
            focusedIndex.value = i;
            return;
          }
        }
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[focusedIndex.value];
      if (!row) return;
      if (row.type === 'directory') void toggleExpand(row);
      else if (isHtml(row)) void openHtml(row);
      else void downloadNode(row);
    } else if (event.key === ' ' && props.markMode) {
      event.preventDefault();
      const row = rows[focusedIndex.value];
      if (row) onCheckboxClick(row);
    }
  }

  watch(visibleRows, (rows) => {
    if (focusedIndex.value > rows.length - 1) focusedIndex.value = Math.max(0, rows.length - 1);
  });

  const onSearchInput = useDebounceFn(async (query: string) => {
    const trimmed = query.trim();
    const requestId = ++searchRequestSeq.value;
    if (!trimmed) {
      searchResults.value = [];
      isSearchLoading.value = false;
      return;
    }
    isSearchLoading.value = true;
    try {
      const response: S3SearchResponse = await $api.file.requestSearchBucketObjects({
        LaboratoryId: props.labId,
        S3Bucket: props.s3Bucket,
        S3Prefix: normalizedRootPrefix.value,
        SearchQuery: trimmed,
        MaxResults: 200,
      } as RequestSearchBucketObjects);
      // Ignore stale responses from slower in-flight requests.
      if (requestId !== searchRequestSeq.value) return;
      const dirs = (response.CommonPrefixes || []).map((prefix) => {
        const relative = prefix.Prefix.startsWith(normalizedRootPrefix.value)
          ? prefix.Prefix.slice(normalizedRootPrefix.value.length).replace(/\/$/, '')
          : prefix.Prefix.replace(/\/$/, '');
        const name = relative.split('/').pop() || relative;
        return {
          id: prefix.Prefix,
          type: 'directory' as const,
          name,
          s3Key: prefix.Prefix,
          relativePath: relative,
          children: [],
          outputLabel: undefined,
        };
      });
      const files = (response.Contents || []).map((item) => {
        const relative = item.Key.startsWith(normalizedRootPrefix.value)
          ? item.Key.slice(normalizedRootPrefix.value.length)
          : item.Key;
        return {
          id: item.Key,
          type: 'file' as const,
          name: item.Key.split('/').pop()!,
          s3Key: item.Key,
          relativePath: relative,
          size: item.Size,
          outputLabel: outputLabelByKey.value.get(item.Key) || outputLabelByKey.value.get(relative),
        };
      });
      searchResults.value = [...dirs, ...files];
    } catch (error) {
      if (requestId !== searchRequestSeq.value) return;
      console.error(error);
      toast.error('Failed to search files');
      searchResults.value = [];
    } finally {
      if (requestId === searchRequestSeq.value) {
        isSearchLoading.value = false;
      }
    }
  }, 300);

  watch(searchQuery, (value) => onSearchInput(value));
</script>

<template>
  <section aria-label="All files" class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <EGSearchInput
        label="Search files or a sample ID"
        class="w-2/3 min-w-[200px] max-w-2xl"
        placeholder="Search files or a sample ID"
        @input-event="(event: string) => (searchQuery = event)"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        :label="hasExpandedFolders ? 'Collapse all' : 'Expand all'"
        :loading="isExpandingAll"
        :disabled="!!searchQuery.trim() || isRootLoading"
        @click="toggleExpandCollapseAll"
      />
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <EGButton
          v-if="canMarkResults && !markMode"
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.secondary"
          icon="i-heroicons-flag"
          :icon-right="false"
          label="Mark results"
          @click="enterMarkMode"
        />
        <EGButton
          v-if="markMode"
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.secondary"
          label="Done"
          :disabled="isPersistingMarks"
          @click="exitMarkMode"
        />
        <EGButton
          v-if="!markMode"
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.primary"
          icon="i-heroicons-arrow-down-tray"
          :icon-right="false"
          :label="downloadRootLabel"
          :disabled="isFolderZipInProgress || isRootLoading"
          @click="downloadRoot"
        />
      </div>
    </div>

    <div
      v-if="markMode"
      class="border-primary/20 bg-primary-muted flex items-start gap-3 rounded-xl border px-4 py-3"
      role="status"
    >
      <UIcon name="i-heroicons-flag" class="text-primary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p class="text-primary text-sm">{{ markBannerText }}</p>
    </div>

    <div
      ref="listEl"
      class="stroke-light overflow-hidden rounded-2xl border border-solid bg-white"
      role="treegrid"
      aria-label="Run files"
      tabindex="0"
      @keydown="onKeydown"
    >
      <div
        class="text-muted grid grid-cols-[minmax(0,1fr)_7rem_6rem_5.5rem] gap-2 border-b border-gray-100 px-4 py-2 text-xs font-medium uppercase tracking-wide"
      >
        <span>Name</span>
        <span class="text-right">Files</span>
        <span class="text-right">Size</span>
        <span />
      </div>

      <div v-if="isRootLoading || isSearchLoading" class="text-muted px-4 py-8 text-center text-sm" role="status">
        Loading…
      </div>
      <div v-else-if="visibleRows.length === 0" class="text-muted px-4 py-8 text-center text-sm">No files found</div>
      <ul v-else class="divide-stroke-light list-none divide-y" role="rowgroup">
        <li
          v-for="(row, index) in visibleRows"
          :key="row.id"
          role="row"
          class="grid grid-cols-[minmax(0,1fr)_7rem_6rem_5.5rem] items-center gap-2 px-4 py-2.5 text-sm"
          :class="[
            index === focusedIndex && !isSelected(row) ? 'bg-primary-muted/40' : 'hover:bg-gray-50',
            markMode && isSelected(row) ? 'ring-primary/40 bg-primary-muted/20 ring-1 ring-inset' : '',
          ]"
          :aria-selected="markMode ? isSelected(row) : undefined"
          :aria-expanded="row.type === 'directory' ? expandedIds.has(row.id) : undefined"
          :aria-level="row.depth + 1"
          @click="focusedIndex = index"
          @dblclick="row.type === 'directory' ? toggleExpand(row) : undefined"
        >
          <div class="flex min-w-0 items-center gap-2" :style="{ paddingLeft: `${row.depth * 1.25}rem` }">
            <input
              v-if="markMode"
              type="checkbox"
              class="border-stroke-light text-primary h-4 w-4 shrink-0 rounded"
              :checked="isSelected(row)"
              :disabled="isPersistingMarks"
              :aria-label="`Mark ${row.name}`"
              @click.prevent.stop="onCheckboxClick(row)"
            />
            <button
              v-if="row.type === 'directory'"
              type="button"
              class="text-muted inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:text-black"
              :aria-label="expandedIds.has(row.id) ? `Collapse ${row.name}` : `Expand ${row.name}`"
              @click.stop="toggleExpand(row)"
            >
              <UIcon
                :name="expandedIds.has(row.id) ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
                class="h-4 w-4"
                aria-hidden="true"
              />
            </button>
            <span v-else class="inline-block w-6 shrink-0" aria-hidden="true" />
            <UIcon
              :name="row.type === 'directory' ? 'i-heroicons-folder' : 'i-heroicons-document-text'"
              class="text-muted h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span class="truncate font-medium text-black">{{ row.name }}{{ row.type === 'directory' ? '/' : '' }}</span>
            <span
              v-if="draftMarks.get(pathKeyFor(row))?.label || row.outputLabel"
              class="bg-primary-muted text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              <UIcon name="i-heroicons-flag" class="h-3 w-3" aria-hidden="true" />
              {{ draftMarks.get(pathKeyFor(row))?.label || row.outputLabel }}
            </span>
            <span v-if="row.isLoading" class="text-muted text-xs" role="status">Loading…</span>
          </div>
          <span class="text-muted text-right tabular-nums">
            <template v-if="row.type === 'directory'">
              {{
                row.fileCount != null
                  ? `${row.fileCount.toLocaleString()} ${row.fileCount === 1 ? 'file' : 'files'}`
                  : '—'
              }}
            </template>
            <template v-else>1 file</template>
          </span>
          <span class="text-muted text-right tabular-nums">
            {{ row.type === 'directory' ? formatBytes(row.totalSize) || '—' : formatBytes(row.size) || '—' }}
          </span>
          <div class="flex justify-end gap-2">
            <button
              v-if="isHtml(row)"
              type="button"
              class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md"
              :aria-label="`Open ${row.name}`"
              @click.stop="openHtml(row)"
            >
              <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md disabled:opacity-50"
              :aria-label="row.type === 'file' ? `Download ${row.name}` : `Download folder ${row.name}`"
              :disabled="isFolderZipInProgress && row.type === 'directory'"
              @click.stop="downloadNode(row)"
            >
              <UIcon name="i-heroicons-arrow-down-tray" class="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>

      <p class="text-muted border-t border-gray-100 px-4 py-3 text-xs">{{ footerLabel }}</p>
    </div>

    <UModal
      :model-value="isMarkModalOpen"
      :ui="{
        overlay: { background: 'bg-gray-800/30' },
        rounded: 'rounded-2xl',
        width: 'sm:max-w-lg',
      }"
      @update:model-value="(open: boolean) => !open && !isMarkModalBusy && closeMarkModal()"
    >
      <div class="p-6">
        <h2 class="text-lg font-semibold text-black">Mark as a selected result</h2>
        <p v-if="markModalNode" class="text-muted mt-2 break-all font-mono text-sm">
          {{ pathKeyFor(markModalNode) }}
        </p>
        <p class="text-muted mt-1 text-sm">{{ markModalSubtitle }}</p>

        <div class="mt-5 space-y-4">
          <EGFormGroup label="Name" name="mark-result-name">
            <UInput
              v-model="markModalName"
              :maxlength="WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH"
              placeholder="Name"
              :disabled="isMarkModalBusy"
            />
          </EGFormGroup>
          <EGFormGroup label="Description (optional)" name="mark-result-description">
            <UInput
              v-model="markModalDescription"
              :maxlength="WORKFLOW_KEY_OUTPUT_DESCRIPTION_MAX_LENGTH"
              placeholder="What this is, for whoever opens the run"
              :disabled="isMarkModalBusy"
            />
          </EGFormGroup>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <EGButton
            :variant="ButtonVariantEnum.enum.secondary"
            label="Cancel"
            :disabled="isMarkModalBusy"
            @click="closeMarkModal"
          />
          <EGButton
            label="Mark"
            :disabled="!markModalName.trim()"
            :loading="isMarkModalBusy"
            @click="confirmMarkModal"
          />
        </div>
      </div>
    </UModal>

    <EGDialog
      v-model="isUnmarkDialogOpen"
      primary-message="Unmark this result?"
      :secondary-message="unmarkDialogSecondary"
      action-label="Confirm"
      :action-variant="ButtonVariantEnum.enum.destructive"
      cancel-label="Cancel"
      :cancel-variant="ButtonVariantEnum.enum.secondary"
      :loading="isUnmarkBusy"
      :buttons-disabled="isUnmarkBusy"
      @action-triggered="confirmUnmark"
      @update:model-value="(open) => !open && closeUnmarkDialog()"
    />
  </section>
</template>
