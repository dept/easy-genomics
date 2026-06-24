import {
  isLaboratoryS3Configured,
  isMissingLaboratoryS3BucketError,
  shouldIgnoreUnlinkedBucketObjectsError,
} from '../../../src/app/utils/laboratory-s3';

describe('isLaboratoryS3Configured', () => {
  it('returns false when lab is null or undefined', () => {
    expect(isLaboratoryS3Configured(null)).toBe(false);
    expect(isLaboratoryS3Configured(undefined)).toBe(false);
  });

  it('returns false when S3Bucket is missing, empty, or whitespace', () => {
    expect(isLaboratoryS3Configured({} as never)).toBe(false);
    expect(isLaboratoryS3Configured({ S3Bucket: '' } as never)).toBe(false);
    expect(isLaboratoryS3Configured({ S3Bucket: '   ' } as never)).toBe(false);
  });

  it('returns true when S3Bucket has a value', () => {
    expect(isLaboratoryS3Configured({ S3Bucket: 'my-bucket' } as never)).toBe(true);
    expect(isLaboratoryS3Configured({ S3Bucket: '  my-bucket  ' } as never)).toBe(true);
  });
});

describe('isMissingLaboratoryS3BucketError', () => {
  it('matches direct and HttpFactory-wrapped API errors', () => {
    expect(isMissingLaboratoryS3BucketError(new Error('Laboratory has no S3 bucket configured'))).toBe(true);
    expect(isMissingLaboratoryS3BucketError(new Error('Request error: Laboratory has no S3 bucket configured'))).toBe(
      true,
    );
  });

  it('returns false for unrelated errors', () => {
    expect(isMissingLaboratoryS3BucketError(new Error('Failed to load unlinked files.'))).toBe(false);
    expect(isMissingLaboratoryS3BucketError('network error')).toBe(false);
  });
});

describe('shouldIgnoreUnlinkedBucketObjectsError', () => {
  it('ignores missing-bucket API errors', () => {
    expect(shouldIgnoreUnlinkedBucketObjectsError(new Error('Laboratory has no S3 bucket configured'), null)).toBe(
      true,
    );
  });

  it('ignores bucket-not-found errors when the lab has no S3 bucket configured', () => {
    const lab = { S3Bucket: '' } as never;
    expect(
      shouldIgnoreUnlinkedBucketObjectsError(new Error('Request error: The specified bucket does not exist'), lab),
    ).toBe(true);
  });

  it('does not ignore bucket-not-found errors when the lab has an S3 bucket configured', () => {
    const lab = { S3Bucket: 'my-bucket' } as never;
    expect(
      shouldIgnoreUnlinkedBucketObjectsError(new Error('Request error: The specified bucket does not exist'), lab),
    ).toBe(false);
  });
});
