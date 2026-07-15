import type { LaboratoryS3Access } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import {
  grantedBucketNamesForLaboratory,
  isS3BucketAccessAllowed,
} from '../../../src/app/utils/laboratory-s3-access-utils';

describe('laboratory-s3-access-utils', () => {
  const labStrict = { EnableNewBucketsByDefault: false as const, LaboratoryId: 'lab-1' };
  const labDefaultOn = { EnableNewBucketsByDefault: true as const, LaboratoryId: 'lab-1' };

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

  describe('isS3BucketAccessAllowed', () => {
    it('strict mode: requires an ALLOW row', () => {
      expect(isS3BucketAccessAllowed(labStrict, [], 'bucket-a')).toBe(false);
      expect(isS3BucketAccessAllowed(labStrict, [allowRow('bucket-a')], 'bucket-a')).toBe(true);
    });

    it('strict mode: DENY row does not grant access', () => {
      expect(isS3BucketAccessAllowed(labStrict, [denyRow('bucket-a')], 'bucket-a')).toBe(false);
    });

    it('default-on: empty rows imply allow', () => {
      expect(isS3BucketAccessAllowed(labDefaultOn, [], 'bucket-new')).toBe(true);
    });

    it('default-on: explicit DENY blocks', () => {
      expect(isS3BucketAccessAllowed(labDefaultOn, [denyRow('bucket-a')], 'bucket-a')).toBe(false);
    });

    it('treats missing EnableNewBucketsByDefault as strict', () => {
      expect(isS3BucketAccessAllowed({}, [], 'bucket-a')).toBe(false);
      expect(isS3BucketAccessAllowed({}, [allowRow('bucket-a')], 'bucket-a')).toBe(true);
    });
  });

  describe('grantedBucketNamesForLaboratory', () => {
    it('strict mode returns only ALLOW buckets', () => {
      expect(grantedBucketNamesForLaboratory(labStrict, [allowRow('bucket-b')], catalog)).toEqual(['bucket-b']);
    });

    it('default-on excludes DENY buckets', () => {
      expect(grantedBucketNamesForLaboratory(labDefaultOn, [denyRow('bucket-a')], catalog)).toEqual(['bucket-b']);
    });
  });
});
