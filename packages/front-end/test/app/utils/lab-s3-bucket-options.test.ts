import { fetchLabS3BucketOptions } from '../../../src/app/utils/lab-s3-bucket-options';

describe('fetchLabS3BucketOptions', () => {
  const api = {
    listGrantedBuckets: jest.fn(),
    listCatalog: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create mode loads bucket names from the org S3 access catalog', async () => {
    api.listCatalog.mockResolvedValue({ buckets: [{ name: 'bucket-a' }, { name: 'bucket-b' }] });

    await expect(
      fetchLabS3BucketOptions({
        isCreateMode: true,
        orgId: 'org-1',
        api,
      }),
    ).resolves.toEqual(['bucket-a', 'bucket-b']);

    expect(api.listCatalog).toHaveBeenCalledWith('org-1');
    expect(api.listGrantedBuckets).not.toHaveBeenCalled();
  });

  it('edit mode loads effective granted buckets for the lab', async () => {
    api.listGrantedBuckets.mockResolvedValue({ buckets: ['bucket-a'] });

    await expect(
      fetchLabS3BucketOptions({
        isCreateMode: false,
        labId: 'lab-1',
        orgId: 'org-1',
        api,
      }),
    ).resolves.toEqual(['bucket-a']);

    expect(api.listGrantedBuckets).toHaveBeenCalledWith('lab-1');
    expect(api.listCatalog).not.toHaveBeenCalled();
  });

  it('create mode returns an empty list when orgId is missing', async () => {
    await expect(
      fetchLabS3BucketOptions({
        isCreateMode: true,
        orgId: null,
        api,
      }),
    ).resolves.toEqual([]);

    expect(api.listCatalog).not.toHaveBeenCalled();
    expect(api.listGrantedBuckets).not.toHaveBeenCalled();
  });
});
