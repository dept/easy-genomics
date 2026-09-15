import { createPinia, setActivePinia } from 'pinia';
import useDataCollectionsStore, { UNLINKED_SCAN_TTL_MS } from '../../../src/app/stores/dataCollections';

describe('dataCollections store unlinked scan cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('treats a missing scan as stale and a fresh scan as current', () => {
    const store = useDataCollectionsStore();
    expect(store.isUnlinkedScanStale('lab-1')).toBe(true);

    store.setUnlinkedScan(
      'lab-1',
      {
        Contents: [{ Key: 'org-1/lab-1/reads.fq.gz' }],
        IsTruncated: false,
        S3Bucket: 'bucket',
        ResolvedPrefix: 'org-1/lab-1/',
      },
      1_000,
    );

    expect(store.unlinkedScan('lab-1')?.files).toEqual([{ Key: 'org-1/lab-1/reads.fq.gz' }]);
    expect(store.isUnlinkedScanStale('lab-1', 1_000 + UNLINKED_SCAN_TTL_MS - 1)).toBe(false);
    expect(store.isUnlinkedScanStale('lab-1', 1_000 + UNLINKED_SCAN_TTL_MS)).toBe(true);
  });

  it('clearUnlinkedScan drops only the requested lab', () => {
    const store = useDataCollectionsStore();
    store.setUnlinkedScan('lab-1', {
      Contents: [],
      IsTruncated: false,
      S3Bucket: 'bucket',
      ResolvedPrefix: 'org-1/lab-1/',
    });
    store.setUnlinkedScan('lab-2', {
      Contents: [{ Key: 'b.fq.gz' }],
      IsTruncated: false,
      S3Bucket: 'bucket',
      ResolvedPrefix: 'org-1/lab-2/',
    });

    store.clearUnlinkedScan('lab-1');

    expect(store.unlinkedScan('lab-1')).toBeNull();
    expect(store.unlinkedScan('lab-2')?.files).toEqual([{ Key: 'b.fq.gz' }]);
  });
});
