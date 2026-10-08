import { buildImportDestKey, buildS3CopyJobs } from '../../../src/app/utils/data-collections-copy-jobs';

describe('buildImportDestKey', () => {
  const destPrefix = 'org-1/lab-1/imports/run-1/';

  it('keeps a single-folder import flat, exactly as before', () => {
    expect(buildImportDestKey('org-1/lab-1/run-1/S1_R1_001.fastq.gz', 'org-1/lab-1/run-1/', destPrefix)).toBe(
      'org-1/lab-1/imports/run-1/S1_R1_001.fastq.gz',
    );
  });

  it('keeps the subfolder below the listed folder, so repeated basenames stay distinct', () => {
    const sourcePrefix = 'org-1/lab-1/aws-healthomics/';
    expect(buildImportDestKey(`${sourcePrefix}txn-a/ZRXSXL_R1_001.fastq.gz`, sourcePrefix, destPrefix)).toBe(
      'org-1/lab-1/imports/run-1/txn-a/ZRXSXL_R1_001.fastq.gz',
    );
    expect(buildImportDestKey(`${sourcePrefix}txn-b/ZRXSXL_R1_001.fastq.gz`, sourcePrefix, destPrefix)).toBe(
      'org-1/lab-1/imports/run-1/txn-b/ZRXSXL_R1_001.fastq.gz',
    );
  });

  it('keeps the whole key for a file outside the listed folder rather than collapsing it to its basename', () => {
    expect(buildImportDestKey('org-1/lab-1/elsewhere/S1_R1.fastq.gz', 'org-1/lab-1/run-1/', destPrefix)).toBe(
      'org-1/lab-1/imports/run-1/org-1/lab-1/elsewhere/S1_R1.fastq.gz',
    );
  });
});

describe('buildS3CopyJobs', () => {
  const destPrefix = 'org-1/lab-1/imports/run-1/';
  const sourcePrefix = 'org-1/lab-1/aws-healthomics/';

  it('copies from the exact listed key, keeping the lab root and subfolders', () => {
    const jobs = buildS3CopyJobs(
      [{ fileName: 'org-1/lab-1/aws-healthomics/txn-1/S1_R1_001.fastq.gz' }],
      'lab-bucket',
      sourcePrefix,
      destPrefix,
    );
    expect(jobs).toEqual([
      {
        SourceBucket: 'lab-bucket',
        SourceKey: 'org-1/lab-1/aws-healthomics/txn-1/S1_R1_001.fastq.gz',
        DestKey: 'org-1/lab-1/imports/run-1/txn-1/S1_R1_001.fastq.gz',
      },
    ]);
  });

  it('returns one job per file', () => {
    const jobs = buildS3CopyJobs(
      [{ fileName: 'org-1/lab-1/a/S1_R1.fastq.gz' }, { fileName: 'org-1/lab-1/a/S1_R2.fastq.gz' }],
      'lab-bucket',
      'org-1/lab-1/a/',
      destPrefix,
    );
    expect(jobs.map((j) => j.SourceKey)).toEqual(['org-1/lab-1/a/S1_R1.fastq.gz', 'org-1/lab-1/a/S1_R2.fastq.gz']);
  });

  it('gives same-named files from two folders two different destinations', () => {
    const jobs = buildS3CopyJobs(
      [
        { fileName: `${sourcePrefix}txn-a/ZRXSXL_R1_001.fastq.gz` },
        { fileName: `${sourcePrefix}txn-b/ZRXSXL_R1_001.fastq.gz` },
      ],
      'lab-bucket',
      sourcePrefix,
      destPrefix,
    );
    expect(new Set(jobs.map((j) => j.DestKey)).size).toBe(2);
  });
});
