import { rewriteS3UriHost } from '../../scripts/lib/lab-s3-uri-migration';

describe('rewriteS3UriHost', () => {
  const oldBucket = 'pre-prod-quality-main-bac-preprodqualitydataprovis-qnef7o7lyeju';
  const newBucket = '654654609030-pre-prod-quality-lab-bucket';

  it('rewrites bucket host and preserves key suffix', () => {
    const uri =
      's3://pre-prod-quality-main-bac-preprodqualitydataprovis-qnef7o7lyeju/org/lab/aws-healthomics/run/samplesheet.csv';
    expect(rewriteS3UriHost(uri, oldBucket, newBucket)).toBe(
      's3://654654609030-pre-prod-quality-lab-bucket/org/lab/aws-healthomics/run/samplesheet.csv',
    );
  });

  it('leaves URIs for other buckets unchanged', () => {
    const uri = 's3://other-bucket/org/lab/file.csv';
    expect(rewriteS3UriHost(uri, oldBucket, newBucket)).toBe(uri);
  });

  it('returns undefined and empty string unchanged', () => {
    expect(rewriteS3UriHost(undefined, oldBucket, newBucket)).toBeUndefined();
    expect(rewriteS3UriHost('', oldBucket, newBucket)).toBe('');
  });

  it('returns non-s3 values unchanged', () => {
    expect(rewriteS3UriHost('https://example.com/x', oldBucket, newBucket)).toBe('https://example.com/x');
  });
});
