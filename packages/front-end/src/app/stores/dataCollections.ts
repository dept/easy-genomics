import type { UnlinkedBucketObjectsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { defineStore } from 'pinia';

export type UnlinkedFile = { Key: string; Size?: number; LastModified?: string };

export interface UnlinkedScan {
  files: UnlinkedFile[];
  s3Bucket: string;
  resolvedPrefix: string;
  isTruncated: boolean;
  scannedAt: number;
}

/**
 * How long a scan is served without contacting the API. Scanning a lab bucket walks every
 * transaction prefix in S3, so results are reused across navigation and only refreshed in the
 * background once stale. Anything that links files (imports, sample creation) invalidates
 * explicitly, and "Rescan bucket" always forces a fresh scan.
 */
export const UNLINKED_SCAN_TTL_MS = 5 * 60 * 1000;

interface DataCollectionsStoreState {
  /** Indexed by labId. Deliberately not persisted: a scan can hold thousands of keys. */
  unlinkedScans: Record<string, UnlinkedScan>;
}

const initialState = (): DataCollectionsStoreState => ({
  unlinkedScans: {},
});

const useDataCollectionsStore = defineStore('dataCollectionsStore', {
  state: initialState,

  getters: {
    unlinkedScan:
      (state: DataCollectionsStoreState) =>
      (labId: string): UnlinkedScan | null =>
        state.unlinkedScans[labId] ?? null,

    isUnlinkedScanStale:
      (state: DataCollectionsStoreState) =>
      (labId: string, now: number = Date.now()): boolean => {
        const scan = state.unlinkedScans[labId];
        return !scan || now - scan.scannedAt >= UNLINKED_SCAN_TTL_MS;
      },
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    setUnlinkedScan(labId: string, response: UnlinkedBucketObjectsResponse, scannedAt: number = Date.now()): void {
      this.unlinkedScans[labId] = {
        files: response.Contents || [],
        s3Bucket: response.S3Bucket,
        resolvedPrefix: response.ResolvedPrefix,
        isTruncated: response.IsTruncated,
        scannedAt,
      };
    },

    clearUnlinkedScan(labId: string): void {
      delete this.unlinkedScans[labId];
    },
  },
});

export default useDataCollectionsStore;
