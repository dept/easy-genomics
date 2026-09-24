process.env.NAME_PREFIX = 'unit-test';

import { S3Service } from '../../../src/app/services/s3-service';

/**
 * Covers the paginated listing helpers the retention sweep depends on. A truncated listing would
 * leave objects behind while the caller's "did everything drain?" check still reads as success.
 */
describe('S3Service listing helpers', () => {
  let svc: S3Service;
  let listBucketObjectsV2: jest.Mock;

  beforeEach(() => {
    svc = new S3Service();
    listBucketObjectsV2 = jest.fn();
    (svc as unknown as { listBucketObjectsV2: jest.Mock }).listBucketObjectsV2 = listBucketObjectsV2;
  });

  describe('listAllObjectsUnderPrefix', () => {
    it('follows the continuation token across pages', async () => {
      listBucketObjectsV2
        .mockResolvedValueOnce({
          Contents: [{ Key: 'p/a.bam', LastModified: new Date('2020-01-01') }],
          IsTruncated: true,
          NextContinuationToken: 'token-1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'p/b.bam', LastModified: new Date('2020-01-02') }],
          IsTruncated: false,
        });

      const objects = await svc.listAllObjectsUnderPrefix('my-bucket', 'p/');

      expect(listBucketObjectsV2).toHaveBeenCalledTimes(2);
      expect(listBucketObjectsV2.mock.calls[0][0]).toMatchObject({ Bucket: 'my-bucket', Prefix: 'p/' });
      expect(listBucketObjectsV2.mock.calls[0][0].ContinuationToken).toBeUndefined();
      expect(listBucketObjectsV2.mock.calls[1][0].ContinuationToken).toBe('token-1');
      expect(objects.map((o) => o.Key)).toEqual(['p/a.bam', 'p/b.bam']);
      expect(objects[0].LastModified).toEqual(new Date('2020-01-01'));
    });

    it('returns an empty list when the prefix holds nothing', async () => {
      listBucketObjectsV2.mockResolvedValue({ Contents: [], IsTruncated: false });

      await expect(svc.listAllObjectsUnderPrefix('my-bucket', 'p/')).resolves.toEqual([]);
    });

    it('skips entries with no key rather than emitting undefined', async () => {
      listBucketObjectsV2.mockResolvedValue({ Contents: [{ Key: 'p/a.bam' }, {}], IsTruncated: false });

      await expect(svc.listAllObjectsUnderPrefix('my-bucket', 'p/')).resolves.toEqual([
        { Key: 'p/a.bam', LastModified: undefined },
      ]);
    });
  });

  describe('listAllObjectKeysUnderPrefix', () => {
    it('returns just the keys', async () => {
      listBucketObjectsV2.mockResolvedValue({
        Contents: [{ Key: 'p/a.bam' }, { Key: 'p/b.bam' }],
        IsTruncated: false,
      });

      await expect(svc.listAllObjectKeysUnderPrefix('my-bucket', 'p/')).resolves.toEqual(['p/a.bam', 'p/b.bam']);
    });
  });

  describe('listChildPrefixes', () => {
    it('requests a delimiter and paginates the common prefixes', async () => {
      listBucketObjectsV2
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'p/one/' }],
          IsTruncated: true,
          NextContinuationToken: 'token-1',
        })
        .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: 'p/two/' }], IsTruncated: false });

      const prefixes = await svc.listChildPrefixes('my-bucket', 'p/');

      expect(listBucketObjectsV2.mock.calls[0][0].Delimiter).toBe('/');
      expect(listBucketObjectsV2.mock.calls[1][0].ContinuationToken).toBe('token-1');
      expect(prefixes).toEqual(['p/one/', 'p/two/']);
    });

    it('returns an empty list when there are no child prefixes', async () => {
      listBucketObjectsV2.mockResolvedValue({ IsTruncated: false });

      await expect(svc.listChildPrefixes('my-bucket', 'p/')).resolves.toEqual([]);
    });
  });
});
