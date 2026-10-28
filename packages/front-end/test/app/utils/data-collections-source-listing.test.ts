import {
  describeSourceListing,
  locateSharedFasta,
  skipsGroupingStep,
} from '../../../src/app/utils/data-collections-source-listing';

describe('describeSourceListing', () => {
  const searched = { S3Bucket: 'lab-bucket', ResolvedPrefix: 'org-1/lab-1/sample-3-18/' };

  it('names the bucket and resolved prefix the server searched when nothing is found', () => {
    expect(describeSourceListing({ ...searched, Contents: [], ListingTruncated: false, ReturnedKeyCount: 0 })).toEqual({
      kind: 'empty',
      message: 'No files found in s3://lab-bucket/org-1/lab-1/sample-3-18/ — check the bucket and folder.',
    });
  });

  it('treats a missing Contents array as empty', () => {
    expect(describeSourceListing({ ...searched })?.kind).toBe('empty');
  });

  it('says an empty listing may be incomplete when the listing stopped early', () => {
    expect(describeSourceListing({ ...searched, Contents: [], ListingTruncated: true, ReturnedKeyCount: 0 })).toEqual({
      kind: 'empty',
      message:
        'No files found in s3://lab-bucket/org-1/lab-1/sample-3-18/ before the listing stopped early — try a more specific folder.',
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
        'Showing the first 5000 files — the listing stopped early, so results are partial. Try a more specific folder.',
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

describe('skipsGroupingStep', () => {
  const genomes = ['org/lab/genomes/WI-01.fasta', 'org/lab/genomes/WI-02.fa.gz', 'org/lab/genomes/WI-01.fasta.fai'];

  it('skips for FASTA files with no FASTQ', () => {
    expect(skipsGroupingStep(genomes, null)).toBe(true);
  });

  it('keeps the step when the listing also holds FASTQ', () => {
    expect(skipsGroupingStep([...genomes, 'org/lab/genomes/WI-01_R1.fastq.gz'], null)).toBe(false);
  });

  it('keeps the step for a listing with neither FASTA nor FASTQ', () => {
    expect(skipsGroupingStep(['org/lab/aligned/WI-01.bam'], null)).toBe(false);
  });

  it('keeps the step for a truncated listing, which may hold FASTQ past the cut', () => {
    expect(skipsGroupingStep(genomes, { kind: 'truncated', message: 'Showing the first 5000 files' })).toBe(false);
  });
});

describe('locateSharedFasta', () => {
  it('points an S3 import at the listed key in the source bucket', () => {
    expect(locateSharedFasta(['org-1/lab-1/run-1/ref.fa'], { kind: 's3', bucket: 'source-bucket' })).toEqual([
      { name: 'ref.fa', uri: 's3://source-bucket/org-1/lab-1/run-1/ref.fa' },
    ]);
  });

  it('points an upload at the key it was uploaded to in the lab bucket', () => {
    expect(
      locateSharedFasta(['ref.fa'], {
        kind: 'upload',
        bucket: 'lab-bucket',
        uploadedKeysByName: { 'ref.fa': 'org-1/lab-1/aws-healthomics/txn-1/ref.fa' },
      }),
    ).toEqual([{ name: 'ref.fa', uri: 's3://lab-bucket/org-1/lab-1/aws-healthomics/txn-1/ref.fa' }]);
  });

  it('leaves out an upload with no recorded key rather than show a URI that does not exist', () => {
    expect(locateSharedFasta(['ref.fa'], { kind: 'upload', bucket: 'lab-bucket', uploadedKeysByName: {} })).toEqual([]);
  });
});
