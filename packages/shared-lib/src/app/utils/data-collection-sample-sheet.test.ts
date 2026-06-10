import {
  buildSampleSheetFromSequenceSets,
  mapSequenceSetFilesToRoles,
  validateSampleSheetSchema,
} from './data-collection-sample-sheet';

describe('validateSampleSheetSchema', () => {
  it('requires sample_id column', () => {
    const result = validateSampleSheetSchema([{ columnName: 'fastq_1', role: 'read1', required: true }]);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate column names', () => {
    const result = validateSampleSheetSchema([
      { columnName: 'sample', role: 'sample_id', required: true },
      { columnName: 'sample', role: 'read1', required: true },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('mapSequenceSetFilesToRoles', () => {
  it('maps paired-end keys to read1 and read2', () => {
    const result = mapSequenceSetFilesToRoles(
      'paired_end',
      ['org/lab/sample_R1.fastq.gz', 'org/lab/sample_R2.fastq.gz'],
      'my-bucket',
      'SampleA',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roleMap.sample_id).toBe('sample');
      expect(result.roleMap.read1).toBe('s3://my-bucket/org/lab/sample_R1.fastq.gz');
      expect(result.roleMap.read2).toBe('s3://my-bucket/org/lab/sample_R2.fastq.gz');
    }
  });

  it('maps single-end to read1 only', () => {
    const result = mapSequenceSetFilesToRoles('single_end', ['org/lab/sample.fastq.gz'], 'my-bucket', 'SampleA');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roleMap.read1).toContain('sample.fastq.gz');
      expect(result.roleMap.read2).toBeUndefined();
    }
  });
});

describe('buildSampleSheetFromSequenceSets', () => {
  it('builds nf-core paired-end CSV', () => {
    const columns = [
      { columnName: 'sample', role: 'sample_id' as const, required: true },
      { columnName: 'fastq_1', role: 'read1' as const, required: true },
      { columnName: 'fastq_2', role: 'read2' as const, required: true },
    ];
    const result = buildSampleSheetFromSequenceSets(
      columns,
      [
        {
          SequenceSetId: '1',
          Name: 'SampleA',
          Layout: 'paired_end',
          FileKeys: ['org/lab/a_R1.fastq.gz', 'org/lab/a_R2.fastq.gz'],
        },
      ],
      'bucket',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.csv).toContain('sample,fastq_1,fastq_2');
      expect(result.csv).toContain('s3://bucket/org/lab/a_R1.fastq.gz');
      expect(result.inputFileKeys).toHaveLength(2);
    }
  });
});
