process.env.NAME_PREFIX = 'unit-test';

jest.mock('../../../../src/app/services/s3-service');

import {
  bucketTagsIncludeDataType,
  isDataTaggedS3Bucket,
  isExcludedCatalogBucketName,
  listDataTaggedS3Buckets,
} from '../../../../src/app/services/easy-genomics/s3-bucket-catalog-service';
import { S3Service } from '../../../../src/app/services/s3-service';

describe('s3-bucket-catalog-service', () => {
  let mockListBuckets: jest.Mock;
  let mockGetBucketTagging: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const MockS3Service = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBuckets = jest.fn();
    mockGetBucketTagging = jest.fn();
    MockS3Service.prototype.listBuckets = mockListBuckets;
    MockS3Service.prototype.getBucketTagging = mockGetBucketTagging;
  });

  describe('helpers', () => {
    it('excludes cdk and amplify bucket name prefixes', () => {
      expect(isExcludedCatalogBucketName('cdk-hnb659fds-assets')).toBe(true);
      expect(isExcludedCatalogBucketName('amplify-app-hosting')).toBe(true);
      expect(isExcludedCatalogBucketName('my-data-bucket')).toBe(false);
    });

    it('detects the data bucket tag', () => {
      expect(bucketTagsIncludeDataType([{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }])).toBe(true);
      expect(bucketTagsIncludeDataType([{ Key: 'other', Value: 'x' }])).toBe(false);
      expect(bucketTagsIncludeDataType(undefined)).toBe(false);
    });
  });

  describe('isDataTaggedS3Bucket', () => {
    it('returns false for excluded names without calling S3', async () => {
      await expect(isDataTaggedS3Bucket('cdk-assets')).resolves.toBe(false);
      expect(mockGetBucketTagging).not.toHaveBeenCalled();
    });

    it('returns true when the bucket has the data tag', async () => {
      mockGetBucketTagging.mockResolvedValue({
        TagSet: [{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }],
      });
      await expect(isDataTaggedS3Bucket('my-data')).resolves.toBe(true);
    });

    it('returns false when tagging is missing or undefined', async () => {
      mockGetBucketTagging.mockResolvedValue(undefined);
      await expect(isDataTaggedS3Bucket('my-data')).resolves.toBe(false);
    });
  });

  describe('listDataTaggedS3Buckets', () => {
    it('returns only data-tagged non-excluded buckets', async () => {
      mockListBuckets.mockResolvedValue({
        Buckets: [{ Name: 'cdk-x' }, { Name: 'data-a' }, { Name: 'other' }],
      });
      mockGetBucketTagging
        .mockResolvedValueOnce({ TagSet: [{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }] })
        .mockResolvedValueOnce({ TagSet: [{ Key: 'other', Value: 'x' }] });

      await expect(listDataTaggedS3Buckets()).resolves.toEqual([{ name: 'data-a' }]);
    });

    it('throws when Buckets is missing', async () => {
      mockListBuckets.mockResolvedValue({ Buckets: null });
      await expect(listDataTaggedS3Buckets()).rejects.toThrow('Unable to list Buckets');
    });
  });
});
