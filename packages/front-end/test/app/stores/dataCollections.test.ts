import { createPinia, setActivePinia } from 'pinia';
import useDataCollectionsStore, { UNLINKED_SCAN_TTL_MS } from '../../../src/app/stores/dataCollections';

const mockRequestUnlinkedBucketObjects = jest.fn();
const mockRequestLaboratoryBucketObjects = jest.fn();
const mockToastError = jest.fn();

(global as { useNuxtApp?: () => unknown }).useNuxtApp = () => ({
  $api: {
    dataCollections: {
      requestUnlinkedBucketObjects: mockRequestUnlinkedBucketObjects,
      requestLaboratoryBucketObjects: mockRequestLaboratoryBucketObjects,
    },
  },
});

jest.mock('../../../src/app/stores/toast', () => ({
  __esModule: true,
  default: () => ({ error: mockToastError }),
}));

jest.mock('../../../src/app/stores/labs', () => ({
  __esModule: true,
  default: () => ({ labs: {} }),
}));

function scanResponse(key: string, bucket = 'bucket') {
  return {
    Contents: [{ Key: key }],
    IsTruncated: false,
    S3Bucket: bucket,
    ResolvedPrefix: 'org/lab/',
  };
}

describe('dataCollections store unlinked scan cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useDataCollectionsStore().reset();
    mockRequestUnlinkedBucketObjects.mockReset();
    mockToastError.mockReset();
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

  it('skips the API when a fresh cache exists', async () => {
    const store = useDataCollectionsStore();
    store.setUnlinkedScan('lab-1', scanResponse('cached.fq.gz'));

    await store.loadUnlinkedScan('lab-1');

    expect(mockRequestUnlinkedBucketObjects).not.toHaveBeenCalled();
    expect(store.unlinkedScan('lab-1')?.files).toEqual([{ Key: 'cached.fq.gz' }]);
  });

  it('stores a response under the labId the request was started with', async () => {
    const store = useDataCollectionsStore();
    mockRequestUnlinkedBucketObjects.mockImplementation(({ LaboratoryId }: { LaboratoryId: string }) =>
      Promise.resolve(scanResponse(`${LaboratoryId}.fq.gz`, LaboratoryId)),
    );

    await Promise.all([store.loadUnlinkedScan('lab-a'), store.loadUnlinkedScan('lab-b')]);

    expect(store.unlinkedScan('lab-a')?.files).toEqual([{ Key: 'lab-a.fq.gz' }]);
    expect(store.unlinkedScan('lab-a')?.s3Bucket).toBe('lab-a');
    expect(store.unlinkedScan('lab-b')?.files).toEqual([{ Key: 'lab-b.fq.gz' }]);
  });

  it('joins an in-flight scan instead of starting a second walk', async () => {
    const store = useDataCollectionsStore();
    let resolveScan: (value: ReturnType<typeof scanResponse>) => void = () => undefined;
    mockRequestUnlinkedBucketObjects.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );

    const first = store.loadUnlinkedScan('lab-1');
    const second = store.loadUnlinkedScan('lab-1', { force: true });
    expect(mockRequestUnlinkedBucketObjects).toHaveBeenCalledTimes(1);

    resolveScan(scanResponse('only-once.fq.gz'));
    await Promise.all([first, second]);

    expect(mockRequestUnlinkedBucketObjects).toHaveBeenCalledTimes(1);
    expect(store.unlinkedScan('lab-1')?.files).toEqual([{ Key: 'only-once.fq.gz' }]);
  });

  it('discards a late response after the scan was invalidated', async () => {
    const store = useDataCollectionsStore();
    let resolveScan: (value: ReturnType<typeof scanResponse>) => void = () => undefined;
    mockRequestUnlinkedBucketObjects.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );

    const pending = store.loadUnlinkedScan('lab-1');
    store.clearUnlinkedScan('lab-1');
    resolveScan(scanResponse('stale-linked.fq.gz'));
    await pending;

    expect(store.unlinkedScan('lab-1')).toBeNull();
  });
});

describe('dataCollections store source listing', () => {
  const body = {
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
    S3Prefix: 'org-1/lab-1/sample-3-18/',
    MaxTotalKeys: 5000,
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    mockRequestLaboratoryBucketObjects.mockReset();
    mockToastError.mockReset();
  });

  it('returns the listing response unchanged', async () => {
    const response = {
      Contents: [],
      IsTruncated: false,
      S3Bucket: 'lab-bucket',
      ResolvedPrefix: 'org-1/lab-1/sample-3-18/',
      ListingTruncated: false,
      ReturnedKeyCount: 0,
    };
    mockRequestLaboratoryBucketObjects.mockResolvedValue(response);

    await expect(useDataCollectionsStore().fetchLaboratoryBucketObjects(body)).resolves.toEqual(response);
    expect(mockRequestLaboratoryBucketObjects).toHaveBeenCalledWith(body);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('toasts the error message and returns null when the listing fails', async () => {
    mockRequestLaboratoryBucketObjects.mockRejectedValue(
      new Error("S3 prefix must be inside this laboratory's folder"),
    );

    await expect(useDataCollectionsStore().fetchLaboratoryBucketObjects(body)).resolves.toBeNull();
    expect(mockToastError).toHaveBeenCalledWith("S3 prefix must be inside this laboratory's folder");
  });

  it('toasts a generic message for a non-Error rejection', async () => {
    mockRequestLaboratoryBucketObjects.mockRejectedValue('boom');

    await expect(useDataCollectionsStore().fetchLaboratoryBucketObjects(body)).resolves.toBeNull();
    expect(mockToastError).toHaveBeenCalledWith('Failed to list source files');
  });
});
