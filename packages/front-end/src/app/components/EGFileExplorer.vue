<script setup lang="ts">
  import { useChangeCase } from '@vueuse/integrations/useChangeCase';
  import { useDebounceFn } from '@vueuse/core';
  import { format } from 'date-fns';
  import {
    S3Object,
    S3Response,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';

  interface FileTreeNode {
    type?: string;
    name?: string;
    size?: number;
    lastModified?: string;
    // children in the UI are arrays of FileTreeNode (nestify returns arrays).
    // Keep MapType only for the intermediate builder inside transformS3Data.
    children?: FileTreeNode[] | MapType;
  }

  interface MapType {
    [key: string]: FileTreeNode;
  }

  const props = withDefaults(
    defineProps<{
      labId: string;
      s3Bucket: string;
      s3Prefix: string;
      s3Contents: S3Response | null;
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

  // open file browser to start path (if present)
  watch(
    () => currentPath.value[0].children,
    (rootDirChildren) => {
      if (hasOpenedStartPath.value) return; // only do this once
      if (!props.startPath) return;

      // if not at root dir, don't touch it
      if (currentPath.value.length > 1) {
        hasOpenedStartPath.value = true;
        return;
      }

      // Helper function to convert children to array if it's a MapType
      function childrenToArray(children: FileTreeNode[] | MapType | undefined): FileTreeNode[] {
        if (!children) return [];
        if (Array.isArray(children)) return children;
        // If it's a MapType object, convert to array
        return Object.values(children);
      }

      // rootDirChildren can be a MapType or an array; normalize to array for navigation
      let currentChildren: FileTreeNode[] | MapType | undefined = rootDirChildren;
      for (const step of props.startPath) {
        const childrenArray = childrenToArray(currentChildren);
        const resultsChild = childrenArray.find(
          (node: FileTreeNode) => node.type === 'directory' && node.name === step,
        );
        if (!resultsChild) break;

        openDirectory(resultsChild);
        currentChildren = resultsChild.children;
      }

      hasOpenedStartPath.value = true;
    },
  );

  const updatedS3Contents = computed(() => {
    if (props.s3Contents) {
      const transformedData = transformS3Data(props.s3Contents, s3Prefix);
      const children = currentPath.value[0].children;
      const hasNoChildren =
        !children ||
        (Array.isArray(children) && children.length === 0) ||
        (!Array.isArray(children) && Object.keys(children).length === 0);

      if (hasNoChildren) {
        currentPath.value[0].children = transformedData;
      }
      return transformedData;
    }
    return [];
  });

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

  function transformS3Data(s3Contents: S3Response, s3Prefix: string) {
    const map: MapType = {};
    s3Contents?.Contents?.forEach((item: S3Object) => {
      if (item.Key.startsWith(s3Prefix)) {
        const parts = item.Key.slice(s3Prefix.length).split('/').filter(Boolean);
        parts.reduce((acc: MapType, part: string, index: number) => {
          if (!acc[part]) {
            acc[part] = {
              type: index === parts.length - 1 && item.Size > 0 ? 'file' : 'directory',
              name: part,
              size: item.Size,
              lastModified: item.LastModified,
              children: {} as MapType,
            };
          }
          return acc[part].children as MapType;
        }, map);
      }
    });
    return nestify(map);
  }

  function nestify(obj: MapType) {
    return Object.keys(obj)
      .map((key) => {
        const item = obj[key];
        if (Object.keys(item.children || {}).length > 0) {
          item.children = nestify(item.children as MapType);
        } else {
          delete item.children;
        }
        return item;
      })
      .filter((item) => item.type === 'file' || (item.children && Object.keys(item.children).length > 0));
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

  const onRowClicked = useDebounceFn((item: FileTreeNode) => {
    // be defensive: children may be an array or an object during intermediate transforms
    if (item.type === 'directory' && Array.isArray(item.children) && item.children.length) {
      openDirectory(item);
    }
  }, 300);

  const openDirectory = (dir: FileTreeNode) => {
    // Only avoid pushing the exact same directory object as the current last element.
    // Previously we blocked based on name anywhere in the breadcrumb which prevented
    // navigating into directories that share the same name but live under different paths.
    const last = currentPath.value[currentPath.value.length - 1];
    if (last === dir) return;
    currentPath.value.push(dir);
  };

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
    // this isn't an ideal unique string but it's pretty unlikely to match any other files so it's probably good enough
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
      await downloadFolder();
    }
  }

  // Watchers to ensure data reactivity
  watch(currentPath, () => {});
  watch(updatedS3Contents, () => {});
</script>

<template>
  <div>
    <!-- Search input -->
    <EGSearchInput
      @input-event="(event: string) => (searchQuery = event)"
      placeholder="Search files/folders"
      class="mb-6 w-[408px]"
      :disabled="isLoading"
    />

    <!-- Breadcrumbs -->
    <div class="mb-6 flex min-h-[24px] flex-wrap">
      <template v-if="!isLoading">
        <span
          v-for="(crumb, index) in breadcrumbs"
          :key="index"
          @click="navigateTo(index)"
          class="breadcrumb-item text-sm"
          :class="{ 'text-black': index === breadcrumbs.length - 1, 'text-gray-500': index !== breadcrumbs.length - 1 }"
        >
          {{ crumb.name }}
          <UIcon
            v-if="index < breadcrumbs.length - 1"
            size="large"
            name="i-heroicons-chevron-right"
            class="separator"
          />
        </span>
      </template>
    </div>

    <EGTable
      :row-click-action="onRowClicked"
      :table-data="filteredItems"
      :columns="tableColumns"
      no-results-msg="No files or folders found"
      :is-loading="isLoading"
    >
      <template #name-data="{ row }">
        <span v-if="row.type === 'directory'" class="underline hover:no-underline" @click="onRowClicked(row)">
          {{ row.name }}/
        </span>
        <span v-else>
          {{ row.name }}
        </span>
      </template>
      <template #type-data="{ row }">
        {{ useChangeCase(row.type === 'directory' ? 'Folder' : row.type, 'sentenceCase') }}
      </template>
      <template #lastModified-data="{ row }">
        {{ format(row.lastModified, 'MM/dd/yyyy') }}
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
