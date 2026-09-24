import type { UnlinkedBucketObjectsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { defineStore } from 'pinia';
import useLabsStore from './labs';
import useToastStore from './toast';
import { resolveUnlinkedScanAction } from '@FE/utils/data-collections-unlinked-scan';
import { shouldIgnoreUnlinkedBucketObjectsError } from '@FE/utils/laboratory-s3';

export type UnlinkedFile = NonNullable<UnlinkedBucketObjectsResponse['Contents']>[number];

export interface UnlinkedScan {
  files: UnlinkedFile[];
  s3Bucket: string;
  resolvedPrefix: string;
  scannedAt: number;
}

/**
 * How long a scan is served without contacting the API. Scanning a lab bucket walks every
 * transaction prefix in S3, so results are reused across navigation and only refreshed in the
 * background once stale. Anything that links files (imports, sample creation) invalidates
 * explicitly, and "Rescan bucket" always forces a fresh scan.
 */
export const UNLINKED_SCAN_TTL_MS = 5 * 60 * 1000;

/** In-flight promises are kept off Pinia state so they are never serialized. */
const unlinkedScanInFlight = new Map<string, Promise<void>>();

interface DataCollectionsStoreState {
  /** Indexed by labId. Deliberately not persisted: a scan can hold thousands of keys. */
  unlinkedScans: Record<string, UnlinkedScan>;
  /** Bumped on invalidate so a late response cannot resurrect a cleared scan. */
  unlinkedScanGeneration: Record<string, number>;
  unlinkedScanLoading: Record<string, boolean>;
}

const initialState = (): DataCollectionsStoreState => ({
  unlinkedScans: {},
  unlinkedScanGeneration: {},
  unlinkedScanLoading: {},
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

    isUnlinkedScanLoading:
      (state: DataCollectionsStoreState) =>
      (labId: string): boolean =>
        !!state.unlinkedScanLoading[labId],
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
      unlinkedScanInFlight.clear();
    },

    setUnlinkedScan(labId: string, response: UnlinkedBucketObjectsResponse, scannedAt: number = Date.now()): void {
      this.unlinkedScans[labId] = {
        files: response.Contents || [],
        s3Bucket: response.S3Bucket,
        resolvedPrefix: response.ResolvedPrefix,
        scannedAt,
      };
    },

    clearUnlinkedScan(labId: string): void {
      delete this.unlinkedScans[labId];
      this.unlinkedScanGeneration[labId] = (this.unlinkedScanGeneration[labId] ?? 0) + 1;
    },

    /**
     * Load or reuse the unlinked-file scan for a lab. `labId` is captured by the
     * caller so a response is always stored under the lab the request was started for.
     */
    async loadUnlinkedScan(labId: string, opts: { force?: boolean } = {}): Promise<void> {
      const action = resolveUnlinkedScanAction({
        hasCache: !!this.unlinkedScans[labId],
        isStale: this.isUnlinkedScanStale(labId),
        force: !!opts.force,
        requestInFlight: unlinkedScanInFlight.has(labId),
      });

      if (action === 'use-cache') {
        return;
      }

      const existing = unlinkedScanInFlight.get(labId);
      if (action === 'await-in-flight' && existing) {
        await existing;
        return;
      }

      const request: Promise<void> = this.fetchUnlinkedScan(labId).finally(() => {
        if (unlinkedScanInFlight.get(labId) === request) {
          unlinkedScanInFlight.delete(labId);
        }
      });
      unlinkedScanInFlight.set(labId, request);

      if (action === 'fetch-background') {
        return;
      }
      await request;
    },

    async fetchUnlinkedScan(labId: string): Promise<void> {
      const generation = this.unlinkedScanGeneration[labId] ?? 0;
      this.unlinkedScanLoading[labId] = true;
      try {
        const { $api } = useNuxtApp();
        const res = await $api.dataCollections.requestUnlinkedBucketObjects({
          LaboratoryId: labId,
          MaxTotalKeys: 25_000,
        });
        if ((this.unlinkedScanGeneration[labId] ?? 0) !== generation) {
          return;
        }
        this.setUnlinkedScan(labId, res);
      } catch (e: unknown) {
        if ((this.unlinkedScanGeneration[labId] ?? 0) !== generation) {
          return;
        }
        const lab = useLabsStore().labs[labId] ?? null;
        if (shouldIgnoreUnlinkedBucketObjectsError(e, lab)) {
          this.clearUnlinkedScan(labId);
          return;
        }
        useToastStore().error('Failed to load unlinked files.');
      } finally {
        this.unlinkedScanLoading[labId] = false;
      }
    },
  },
});

export default useDataCollectionsStore;
