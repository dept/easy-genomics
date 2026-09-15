import {
  SAMPLE_SHEET_SCHEMA_PRESETS,
  SAMPLE_SHEET_SCHEMA_PRESET_LABELS,
  buildSampleSheetCsv,
  buildSampleSheetFromSamples,
  buildSampleSheetRowFromRoleMap,
  mapSequenceSetFilesToRoles,
  validateSampleSheetRows,
  validateSampleSheetSchema,
} from './data-collection-sample-sheet';
import { isFilenameRegexSafe } from './filename-regex-safety';

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

  it('maps long_reads layout to reads role', () => {
    const result = mapSequenceSetFilesToRoles('long_reads', ['org/lab/sample.fastq.gz'], 'my-bucket', 'SampleA');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roleMap.reads).toContain('sample.fastq.gz');
    }
  });

  it('maps paired_end_with_extras reference FASTA', () => {
    const result = mapSequenceSetFilesToRoles(
      'paired_end_with_extras',
      ['org/lab/sample_R1.fastq.gz', 'org/lab/sample_R2.fastq.gz', 'org/lab/ref.fasta'],
      'my-bucket',
      'SampleA',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roleMap.reference_fasta).toContain('ref.fasta');
    }
  });

  it('returns false for an empty keys array', () => {
    const result = mapSequenceSetFilesToRoles('single_end', [], 'my-bucket', 'SampleA');
    expect(result.ok).toBe(false);
  });
});

describe('validateSampleSheetRows', () => {
  const columns = [
    { columnName: 'sample', role: 'sample_id' as const, required: true },
    { columnName: 'fastq_1', role: 'read1' as const, required: true },
  ];

  it('rejects rows missing required columns', () => {
    const result = validateSampleSheetRows(columns, [{ sample: 'a' }]);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate sample IDs', () => {
    const result = validateSampleSheetRows(columns, [
      { sample: 'a', fastq_1: 's3://b/a.fq' },
      { sample: 'a', fastq_1: 's3://b/b.fq' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('buildSampleSheetCsv', () => {
  it('quotes values that contain commas', () => {
    const csv = buildSampleSheetCsv(
      [{ columnName: 'note', role: 'sample_id', required: true }],
      [{ note: 'hello, world' }],
    );
    expect(csv).toBe('note\n"hello, world"');
  });
});

describe('buildSampleSheetRowFromRoleMap', () => {
  it('maps role values to column names', () => {
    const row = buildSampleSheetRowFromRoleMap(
      [
        { columnName: 'sample', role: 'sample_id', required: true },
        { columnName: 'fastq_1', role: 'read1', required: true },
      ],
      { sample_id: 'sample-a', read1: 's3://bucket/a.fq.gz' },
    );
    expect(row).toEqual({ sample: 'sample-a', fastq_1: 's3://bucket/a.fq.gz' });
  });
});

describe('isFilenameRegexSafe', () => {
  it('rejects nested quantifier patterns', () => {
    expect(isFilenameRegexSafe('(a+)+$')).toBe(false);
  });
});

describe('SAMPLE_SHEET_SCHEMA_PRESETS', () => {
  it('exposes exactly the four default presets with a friendly label each', () => {
    expect(Object.keys(SAMPLE_SHEET_SCHEMA_PRESETS)).toEqual(['single', 'paired', 'hybrid', 'assembled']);
    for (const key of Object.keys(SAMPLE_SHEET_SCHEMA_PRESETS)) {
      expect(SAMPLE_SHEET_SCHEMA_PRESET_LABELS[key]).toBeTruthy();
    }
  });

  it('defines the expected columns and roles', () => {
    expect(SAMPLE_SHEET_SCHEMA_PRESETS.single).toEqual([
      { columnName: 'sample', role: 'sample_id', required: true },
      { columnName: 'fastq', role: 'reads', required: true },
    ]);
    expect(SAMPLE_SHEET_SCHEMA_PRESETS.paired).toEqual([
      { columnName: 'sample', role: 'sample_id', required: true },
      { columnName: 'fastq_1', role: 'read1', required: true },
      { columnName: 'fastq_2', role: 'read2', required: true },
    ]);
    expect(SAMPLE_SHEET_SCHEMA_PRESETS.hybrid).toEqual([
      { columnName: 'sample', role: 'sample_id', required: true },
      { columnName: 'fastq', role: 'reads', required: true },
      { columnName: 'fastq_1', role: 'read1', required: false },
      { columnName: 'fastq_2', role: 'read2', required: false },
    ]);
    expect(SAMPLE_SHEET_SCHEMA_PRESETS.assembled).toEqual([
      { columnName: 'sample', role: 'sample_id', required: true },
      { columnName: 'fasta', role: 'assembly_fasta', required: true },
    ]);
  });
});

describe('buildSampleSheetFromSamples', () => {
  it('builds a paired CSV', () => {
    const result = buildSampleSheetFromSamples(
      SAMPLE_SHEET_SCHEMA_PRESETS.paired,
      [
        {
          SampleId: '1',
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

  it('fills the single preset reads column from a single-end sample (read1 fallback)', () => {
    const result = buildSampleSheetFromSamples(
      SAMPLE_SHEET_SCHEMA_PRESETS.single,
      [
        {
          SampleId: '1',
          Name: 'SampleA',
          Layout: 'single_end',
          FileKeys: ['org/lab/a.fastq.gz'],
        },
      ],
      'bucket',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.csv).toContain('sample,fastq');
      expect(result.rows[0].fastq).toBe('s3://bucket/org/lab/a.fastq.gz');
    }
  });
});
