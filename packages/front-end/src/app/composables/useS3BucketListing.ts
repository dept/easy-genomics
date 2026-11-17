import type {
  RequestListBucketObjects,
  RequestTopLevelBucketObjects,
  S3TopLevelResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import { useToastStore } from '@FE/stores';
import { isS3BucketAccessDeniedError } from '@FE/utils/laboratory-s3';
import { folderStatsFromListContents, type S3FolderStats } from '@FE/utils/s3-folder-stats';

export type { S3FolderStats };

/**
 * Shared S3 prefix listing + cache for File Manager / All files trees.
 * Components still own their node shapes; this owns fetch + cache only.
 */
export default function useS3BucketListing(options: {
  labId: MaybeRefOrGetter<string>;
  s3Bucket: MaybeRefOrGetter<string>;
  runId?: MaybeRefOrGetter<string | undefined>;
}) {
  const { $api } = useNuxtApp();
  const toast = useToastStore();
  const loadedDirectories = ref<Map<string, S3TopLevelResponse>>(new Map());
  const folderStatsCache = ref<Map<string, S3FolderStats>>(new Map());

  function cacheKey(prefix: string): string {
    return `${toValue(options.s3Bucket)}::${prefix}`;
  }

  function clearCache(): void {
    loadedDirectories.value = new Map();
    folderStatsCache.value = new Map();
  }

  async function fetchTopLevel(prefix: string): Promise<S3TopLevelResponse> {
    const key = cacheKey(prefix);
    if (loadedDirectories.value.has(key)) {
      return loadedDirectories.value.get(key)!;
    }
    try {
      const response = await $api.file.requestTopLevelBucketObjects({
        LaboratoryId: toValue(options.labId),
        RunId: toValue(options.runId),
        S3Bucket: toValue(options.s3Bucket),
        S3Prefix: prefix,
      } as RequestTopLevelBucketObjects);
      const next = new Map(loadedDirectories.value);
      next.set(key, response);
      loadedDirectories.value = next;
      return response;
    } catch (error) {
      console.error('Error loading directory children:', error);
      toast.error(
        isS3BucketAccessDeniedError(error)
          ? 'Access to this S3 bucket was revoked. Ask an organization admin to grant access, or set a new default bucket in lab settings.'
          : 'Failed to load folder contents',
      );
      return { Contents: [], CommonPrefixes: [] } as S3TopLevelResponse;
    }
  }

  /**
   * Recursive file count/size under a prefix via list-bucket-objects.
   * shortcut: MaxKeys default may truncate huge folders; raise when product needs exact totals.
   */
  async function fetchFolderStats(prefix: string): Promise<S3FolderStats> {
    const key = cacheKey(prefix);
    if (folderStatsCache.value.has(key)) {
      return folderStatsCache.value.get(key)!;
    }
    try {
      const response = await $api.file.requestListBucketObjects({
        LaboratoryId: toValue(options.labId),
        S3Bucket: toValue(options.s3Bucket),
        S3Prefix: prefix,
      } as RequestListBucketObjects);
      const stats = folderStatsFromListContents(response.Contents);
      const next = new Map(folderStatsCache.value);
      next.set(key, stats);
      folderStatsCache.value = next;
      return stats;
    } catch (error) {
      console.error('Folder stats failed for', prefix, error);
      return { fileCount: 0, totalSize: 0 };
    }
  }

  function prefetchTopLevel(prefixes: string[]): void {
    for (const prefix of prefixes) {
      if (loadedDirectories.value.has(cacheKey(prefix))) continue;
      fetchTopLevel(prefix).catch((error) => console.error('Pre-fetch failed for', prefix, error));
    }
  }

  return {
    loadedDirectories,
    folderStatsCache,
    clearCache,
    fetchTopLevel,
    fetchFolderStats,
    prefetchTopLevel,
  };
}
