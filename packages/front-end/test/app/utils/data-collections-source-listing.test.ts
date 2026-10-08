import { describeSourceListing } from '../../../src/app/utils/data-collections-source-listing';

describe('describeSourceListing', () => {
  const searched = { S3Bucket: 'lab-bucket', ResolvedPrefix: 'org-1/lab-1/sample-3-18/' };

  it('names the bucket and resolved prefix the server searched when nothing is found', () => {
    expect(describeSourceListing({ ...searched, Contents: [], ListingTruncated: false, ReturnedKeyCount: 0 })).toEqual({
      kind: 'empty',
      message: 'No files found in s3://lab-bucket/org-1/lab-1/sample-3-18/ — check the bucket and prefix.',
    });
  });

  it('treats a missing Contents array as empty', () => {
    expect(describeSourceListing({ ...searched })?.kind).toBe('empty');
  });

  it('says an empty listing may be incomplete when the listing stopped early', () => {
    expect(describeSourceListing({ ...searched, Contents: [], ListingTruncated: true, ReturnedKeyCount: 0 })).toEqual({
      kind: 'empty',
      message:
        'No files found in s3://lab-bucket/org-1/lab-1/sample-3-18/ before the listing stopped early — try a narrower prefix.',
    });
  });

  it('warns with the returned key count when a non-empty listing was truncated', () => {
    expect(
      describeSourceListing({
        ...searched,
        Contents: [{ Key: 'a.fastq.gz' }, { Key: 'b.fastq.gz' }],
        ListingTruncated: true,
        ReturnedKeyCount: 5000,
      }),
    ).toEqual({
      kind: 'truncated',
      message:
        'Showing the first 5000 files — the listing stopped early, so results are partial. Try a narrower prefix.',
    });
  });

  it('falls back to the Contents length when ReturnedKeyCount is absent', () => {
    const notice = describeSourceListing({
      ...searched,
      Contents: [{ Key: 'a.fastq.gz' }, { Key: 'b.fastq.gz' }, { Key: 'c.fastq.gz' }],
      ListingTruncated: true,
    });
    expect(notice?.message).toContain('Showing the first 3 files');
  });

  it('returns null for a complete, non-empty listing', () => {
    expect(
      describeSourceListing({
        ...searched,
        Contents: [{ Key: 'a.fastq.gz' }],
        ListingTruncated: false,
        ReturnedKeyCount: 1,
      }),
    ).toBeNull();
  });
});
