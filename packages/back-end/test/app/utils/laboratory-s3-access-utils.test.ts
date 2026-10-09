process.env.NAME_PREFIX = 'unit-test';

const mockListByLaboratoryId = jest.fn();
const mockIsDataTaggedS3Bucket = jest.fn();

jest.mock('../../../src/app/services/easy-genomics/laboratory-s3-access-service', () => ({
  LaboratoryS3AccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListByLaboratoryId,
  })),
}));

jest.mock('../../../src/app/services/easy-genomics/s3-bucket-catalog-service', () => ({
  isDataTaggedS3Bucket: (...args: unknown[]) => mockIsDataTaggedS3Bucket(...args),
  listDataTaggedS3Buckets: jest.fn(),
}));

import type { LaboratoryS3Access } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { LaboratoryS3AccessService } from '../../../src/app/services/easy-genomics/laboratory-s3-access-service';
import {
  assertLaboratoryHasS3BucketAccess,
  findAllowedPrefix,
  grantedBucketNamesForLaboratory,
  isS3BucketAccessAllowed,
} from '../../../src/app/utils/laboratory-s3-access-utils';

describe('laboratory-s3-access-utils', () => {
  const labStrict = { EnableNewBucketsByDefault: false as const, LaboratoryId: 'lab-1', S3Bucket: 'bucket-a' };
  const labDefaultOn = { EnableNewBucketsByDefault: true as const, LaboratoryId: 'lab-1', S3Bucket: 'bucket-a' };

  function allowRow(bucketName: string): LaboratoryS3Access {
    return {
      LaboratoryId: 'lab-1',
      BucketName: bucketName,
      OrganizationId: 'org-1',
    };
  }

  function denyRow(bucketName: string): LaboratoryS3Access {
    return {
      LaboratoryId: 'lab-1',
      BucketName: bucketName,
      OrganizationId: 'org-1',
      Effect: 'DENY',
    };
  }

  const catalog = [{ name: 'bucket-a' }, { name: 'bucket-b' }];

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDataTaggedS3Bucket.mockResolvedValue(true);
  });

  describe('isS3BucketAccessAllowed', () => {
    it('strict mode: requires an ALLOW row', () => {
      expect(isS3BucketAccessAllowed(labStrict, [allowRow('bucket-a')], 'bucket-a')).toBe(true);
      expect(isS3BucketAccessAllowed(labStrict, [allowRow('bucket-a')], 'bucket-b')).toBe(false);
    });

    it('strict mode: DENY row does not grant access', () => {
      expect(isS3BucketAccessAllowed(labStrict, [denyRow('bucket-a')], 'bucket-a')).toBe(false);
    });

    it('strict mode with zero rows: allows the configured S3Bucket only', () => {
      expect(isS3BucketAccessAllowed(labStrict, [], 'bucket-a')).toBe(true);
      expect(isS3BucketAccessAllowed(labStrict, [], 'bucket-other')).toBe(false);
    });

    it('strict mode with zero rows and no configured bucket: denies', () => {
      expect(isS3BucketAccessAllowed({ EnableNewBucketsByDefault: false }, [], 'bucket-a')).toBe(false);
    });

    it('default-on: empty rows imply allow', () => {
      expect(isS3BucketAccessAllowed(labDefaultOn, [], 'bucket-new')).toBe(true);
    });

    it('default-on: explicit DENY blocks', () => {
      expect(isS3BucketAccessAllowed(labDefaultOn, [denyRow('bucket-a')], 'bucket-a')).toBe(false);
    });

    it('treats missing EnableNewBucketsByDefault as strict', () => {
      expect(isS3BucketAccessAllowed({ S3Bucket: 'bucket-a' }, [], 'bucket-a')).toBe(true);
      expect(isS3BucketAccessAllowed({}, [allowRow('bucket-a')], 'bucket-a')).toBe(true);
      expect(isS3BucketAccessAllowed({}, [], 'bucket-a')).toBe(false);
    });
  });

  describe('grantedBucketNamesForLaboratory', () => {
    it('strict mode returns only ALLOW buckets', () => {
      expect(grantedBucketNamesForLaboratory(labStrict, [allowRow('bucket-b')], catalog)).toEqual(['bucket-b']);
    });

    it('strict mode with zero rows returns empty list (configured default handled by warning UX)', () => {
      expect(grantedBucketNamesForLaboratory(labStrict, [], catalog)).toEqual([]);
    });

    it('strict mode excludes ALLOW buckets that are no longer in the catalog', () => {
      expect(grantedBucketNamesForLaboratory(labStrict, [allowRow('stale-bucket')], catalog)).toEqual([]);
    });

    it('strict mode includes ALLOW buckets that remain in the catalog', () => {
      expect(grantedBucketNamesForLaboratory(labStrict, [allowRow('bucket-a')], catalog)).toEqual(['bucket-a']);
    });

    it('default-on excludes DENY buckets', () => {
      expect(grantedBucketNamesForLaboratory(labDefaultOn, [denyRow('bucket-a')], catalog)).toEqual(['bucket-b']);
    });
  });

  describe('findAllowedPrefix', () => {
    const withPrefix = (bucketName: string, effect?: 'ALLOW' | 'DENY'): LaboratoryS3Access => ({
      ...allowRow(bucketName),
      ...(effect ? { Effect: effect } : {}),
      AllowedPrefix: 'sample-3-18/',
    });

    it('returns the prefix stored on the ALLOW row for that bucket', () => {
      expect(findAllowedPrefix([withPrefix('bucket-a', 'ALLOW')], 'bucket-a')).toBe('sample-3-18/');
    });

    it('treats a legacy row without Effect as ALLOW', () => {
      expect(findAllowedPrefix([withPrefix('bucket-a')], 'bucket-a')).toBe('sample-3-18/');
    });

    it("never applies one bucket's prefix to another bucket", () => {
      expect(findAllowedPrefix([withPrefix('bucket-a', 'ALLOW')], 'bucket-b')).toBeUndefined();
    });

    it('ignores a prefix on a DENY row', () => {
      expect(findAllowedPrefix([withPrefix('bucket-a', 'DENY')], 'bucket-a')).toBeUndefined();
    });

    it('returns undefined when the lab has no row for the bucket', () => {
      expect(findAllowedPrefix([], 'bucket-a')).toBeUndefined();
    });

    it('strict lab given a prefix on its own S3Bucket keeps access and gains the folder', () => {
      const rowsAfterSettingPrefix = [withPrefix('bucket-a', 'ALLOW')];
      expect(isS3BucketAccessAllowed(labStrict, rowsAfterSettingPrefix, 'bucket-a')).toBe(true);
      expect(findAllowedPrefix(rowsAfterSettingPrefix, 'bucket-a')).toBe('sample-3-18/');
    });
  });

  describe('assertLaboratoryHasS3BucketAccess', () => {
    const accessService = new LaboratoryS3AccessService();

    it('denies empty bucket name', async () => {
      await expect(assertLaboratoryHasS3BucketAccess(labStrict, '', accessService)).rejects.toThrow(
        'S3 bucket access denied',
      );
    });

    it('denies buckets not in the supplied catalog', async () => {
      await expect(
        assertLaboratoryHasS3BucketAccess(labDefaultOn, 'not-in-catalog', accessService, catalog),
      ).rejects.toThrow('S3 bucket access denied');
      expect(mockListByLaboratoryId).not.toHaveBeenCalled();
    });

    it('denies when single-bucket tag check fails', async () => {
      mockIsDataTaggedS3Bucket.mockResolvedValue(false);
      await expect(assertLaboratoryHasS3BucketAccess(labDefaultOn, 'other-bucket', accessService)).rejects.toThrow(
        'S3 bucket access denied',
      );
      expect(mockListByLaboratoryId).not.toHaveBeenCalled();
    });

    it('allows default-on catalog bucket with no DENY row', async () => {
      mockListByLaboratoryId.mockResolvedValue([]);
      await expect(
        assertLaboratoryHasS3BucketAccess(labDefaultOn, 'bucket-b', accessService, catalog),
      ).resolves.toEqual([]);
    });

    it('allows strict configured bucket with zero access rows (migration fallback)', async () => {
      mockListByLaboratoryId.mockResolvedValue([]);
      await expect(assertLaboratoryHasS3BucketAccess(labStrict, 'bucket-a', accessService, catalog)).resolves.toEqual(
        [],
      );
    });

    it('denies strict non-configured bucket with zero access rows', async () => {
      mockListByLaboratoryId.mockResolvedValue([]);
      await expect(assertLaboratoryHasS3BucketAccess(labStrict, 'bucket-b', accessService, catalog)).rejects.toThrow(
        'S3 bucket access denied',
      );
    });

    it('returns the access rows it loaded, so callers can read the allowed prefix', async () => {
      const rows = [{ ...allowRow('bucket-a'), AllowedPrefix: 'sample-3-18/' }];
      mockListByLaboratoryId.mockResolvedValueOnce(rows);
      await expect(assertLaboratoryHasS3BucketAccess(labStrict, 'bucket-a', accessService)).resolves.toEqual(rows);
    });
  });
});
