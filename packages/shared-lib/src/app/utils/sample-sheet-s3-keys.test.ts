import { extractS3KeysFromCsv } from './sample-sheet-s3-keys';

describe('extractS3KeysFromCsv', () => {
  const bucket = 'lab-data-bucket';

  it('returns empty array for empty csv or bucket', () => {
    expect(extractS3KeysFromCsv('', bucket)).toEqual([]);
    expect(extractS3KeysFromCsv('sample_id,fastq\n', '')).toEqual([]);
    expect(extractS3KeysFromCsv('', '')).toEqual([]);
  });

  it('extracts keys for matching bucket and de-duplicates', () => {
    const csv = [
      `s3://${bucket}/org/lab/run1_R1.fastq.gz`,
      `s3://${bucket}/org/lab/run1_R2.fastq.gz`,
      `s3://${bucket}/org/lab/run1_R1.fastq.gz`,
    ].join('\n');
    expect(extractS3KeysFromCsv(csv, bucket).sort()).toEqual(
      ['org/lab/run1_R1.fastq.gz', 'org/lab/run1_R2.fastq.gz'].sort(),
    );
  });

  it('ignores references that point at a different bucket', () => {
    const csv = `s3://${bucket}/ok.fastq.gz,s3://other-bucket/nope.fastq.gz`;
    expect(extractS3KeysFromCsv(csv, bucket)).toEqual(['ok.fastq.gz']);
  });

  it('parses s3 URIs inside double-quoted CSV fields', () => {
    const csv = `sample,fastq_1\n1,"s3://${bucket}/path/in/quoted.csv"`;
    expect(extractS3KeysFromCsv(csv, bucket)).toEqual(['path/in/quoted.csv']);
  });

  it('stops the key segment at a comma (permissive regex does not span CSV delimiters)', () => {
    const csv = `s3://${bucket}/org/lab/file,with,commas,in,name.txt`;
    expect(extractS3KeysFromCsv(csv, bucket)).toEqual(['org/lab/file']);
  });

  it('is case-sensitive on the bucket name', () => {
    const csv = 's3://Lab-Data-Bucket/some/key.txt';
    expect(extractS3KeysFromCsv(csv, bucket)).toEqual([]);
    expect(extractS3KeysFromCsv(csv, 'Lab-Data-Bucket')).toEqual(['some/key.txt']);
  });
});
