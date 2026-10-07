import { buildS3CopyJobs } from '../../../src/app/utils/data-collections-copy-jobs';

describe('buildS3CopyJobs', () => {
  const destPrefix = 'org-1/lab-1/imports/run-1/';

  it('copies from the exact listed key, keeping the lab root and subfolders', () => {
    const jobs = buildS3CopyJobs(
      [{ fileName: 'org-1/lab-1/aws-healthomics/txn-1/S1_R1_001.fastq.gz' }],
      'lab-bucket',
      destPrefix,
    );
    expect(jobs).toEqual([
      {
        SourceBucket: 'lab-bucket',
        SourceKey: 'org-1/lab-1/aws-healthomics/txn-1/S1_R1_001.fastq.gz',
        DestKey: 'org-1/lab-1/imports/run-1/S1_R1_001.fastq.gz',
      },
    ]);
  });

  it('returns one job per file', () => {
    const jobs = buildS3CopyJobs(
      [{ fileName: 'org-1/lab-1/a/S1_R1.fastq.gz' }, { fileName: 'org-1/lab-1/a/S1_R2.fastq.gz' }],
      'lab-bucket',
      destPrefix,
    );
    expect(jobs.map((j) => j.SourceKey)).toEqual(['org-1/lab-1/a/S1_R1.fastq.gz', 'org-1/lab-1/a/S1_R2.fastq.gz']);
  });
});
