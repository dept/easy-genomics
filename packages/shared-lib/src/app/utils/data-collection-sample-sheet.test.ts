import {
  SAMPLE_SHEET_SCHEMA_PRESETS,
  SAMPLE_SHEET_SCHEMA_PRESET_LABELS,
  buildSampleSheetCsv,
  buildSampleSheetFromSamples,
  buildSampleSheetRowFromRoleMap,
  mapSequenceSetFilesToRoles,
  upgradeLayoutForAddedFiles,
  validateSampleSheetRows,
  validateSampleSheetSchema,
} from './data-collection-sample-sheet';
import { isFilenameRegexSafe } from './filename-regex-safety';
import type { SampleLayout, SampleSheetColumnDef } from '../types/easy-genomics/samples';

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

  it('maps every extra file role under paired_end_with_extras', () => {
    const result = mapSequenceSetFilesToRoles(
      'paired_end_with_extras',
      [
        'org/lab/s_R1.fastq.gz',
        'org/lab/s_R2.fastq.gz',
        'org/lab/ref.fna',
        'org/lab/genes.gtf',
        'org/lab/genes.gff3',
        'org/lab/targets.bed',
        'org/lab/s.bam',
        'org/lab/s.cram',
        'org/lab/calls.vcf.gz',
      ],
      'b',
      'S',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roleMap).toMatchObject({
        reference_fasta: 's3://b/org/lab/ref.fna',
        reference_gtf: 's3://b/org/lab/genes.gtf',
        reference_gff: 's3://b/org/lab/genes.gff3',
        reference_bed: 's3://b/org/lab/targets.bed',
        input_bam: 's3://b/org/lab/s.bam',
        input_cram: 's3://b/org/lab/s.cram',
        input_vcf: 's3://b/org/lab/calls.vcf.gz',
      });
    }
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

describe('assembled samples', () => {
  const genomeKey = 'org/lab/genomes/WI-01.fasta';
  const assembledSample = {
    SampleId: '1',
    Name: 'WI-01',
    Layout: 'assembled' as const,
    FileKeys: [genomeKey],
  };
  const mismatchMessage = (columnName: string) =>
    `WI-01: this sample holds an assembled genome (FASTA) and no FASTQ reads, but column "${columnName}" needs reads. Use a sequence collection with the Assembled preset.`;

  it.each(['WI-01.fa', 'WI-01.fasta', 'WI-01.fna', 'WI-01.fa.gz'])('maps %s to assembly_fasta', (fileName) => {
    const key = `org/lab/genomes/${fileName}`;
    expect(mapSequenceSetFilesToRoles('assembled', [key], 'bucket', 'WI-01')).toEqual({
      ok: true,
      roleMap: { sample_id: 'WI-01', assembly_fasta: `s3://bucket/${key}` },
      inputFileKeys: [key],
    });
  });

  it('uses the first sorted FASTA and keeps every key as an input', () => {
    const keys = ['org/lab/genomes/WI-01.txt', 'org/lab/genomes/WI-01_b.fa', 'org/lab/genomes/WI-01_a.fa'];
    const result = mapSequenceSetFilesToRoles('assembled', keys, 'bucket', 'WI-01');
    expect(result.ok && result.roleMap.assembly_fasta).toBe('s3://bucket/org/lab/genomes/WI-01_a.fa');
    expect(result.ok && result.inputFileKeys).toHaveLength(3);
  });

  it('rejects an assembled sample with no FASTA', () => {
    expect(mapSequenceSetFilesToRoles('assembled', ['org/lab/WI-01.txt'], 'bucket', 'WI-01')).toEqual({
      ok: false,
      message: 'Assembled sample requires at least one FASTA file.',
    });
  });

  it('maps a FASTA-only single_end sample as assembled', () => {
    expect(mapSequenceSetFilesToRoles('single_end', [genomeKey], 'bucket', 'WI-01')).toEqual({
      ok: true,
      roleMap: { sample_id: 'WI-01', assembly_fasta: `s3://bucket/${genomeKey}` },
      inputFileKeys: [genomeKey],
    });
  });

  it('still rejects a single_end sample with neither FASTQ nor FASTA', () => {
    expect(mapSequenceSetFilesToRoles('single_end', ['org/lab/a.bam'], 'bucket', 'A')).toEqual({
      ok: false,
      message: 'Single-end sample requires at least one FASTQ file.',
    });
  });

  it('keeps a single_end sample with an R1 and a FASTA on read1', () => {
    const result = mapSequenceSetFilesToRoles('single_end', ['org/lab/a_R1.fastq.gz', 'org/lab/a.fa'], 'bucket', 'A');
    expect(result.ok && result.roleMap.read1).toBe('s3://bucket/org/lab/a_R1.fastq.gz');
    expect(result.ok && result.roleMap.assembly_fasta).toBeUndefined();
  });

  it('builds one Assembled row per sample, including a FASTA-only single_end sample', () => {
    const result = buildSampleSheetFromSamples(
      SAMPLE_SHEET_SCHEMA_PRESETS.assembled,
      [
        assembledSample,
        { SampleId: '2', Name: 'WI-02', Layout: 'single_end', FileKeys: ['org/lab/genomes/WI-02.fa.gz'] },
      ],
      'bucket',
    );
    expect(result.ok && result.csv).toBe(
      'sample,fasta\nWI-01,s3://bucket/org/lab/genomes/WI-01.fasta\nWI-02,s3://bucket/org/lab/genomes/WI-02.fa.gz',
    );
  });

  it.each([
    ['single', 'fastq'],
    ['paired', 'fastq_1'],
    ['hybrid', 'fastq'],
  ] as const)('names the mismatch under the %s preset', (presetKey, columnName) => {
    expect(buildSampleSheetFromSamples(SAMPLE_SHEET_SCHEMA_PRESETS[presetKey], [assembledSample], 'bucket')).toEqual({
      ok: false,
      message: mismatchMessage(columnName),
    });
  });

  it('names the assembled sample in a mixed collection', () => {
    const pairedSample = {
      SampleId: '2',
      Name: 'SampleA',
      Layout: 'paired_end' as const,
      FileKeys: ['org/lab/a_R1.fastq.gz', 'org/lab/a_R2.fastq.gz'],
    };
    expect(
      buildSampleSheetFromSamples(SAMPLE_SHEET_SCHEMA_PRESETS.paired, [pairedSample, assembledSample], 'bucket'),
    ).toEqual({ ok: false, message: mismatchMessage('fastq_1') });
  });
});

describe('upgradeLayoutForAddedFiles', () => {
  it.each([
    ['single_end', ['org/lab/s_R2_001.fastq.gz'], 'paired_end'],
    ['single_end', ['org/lab/s_R2_001.fastq.gz', 'org/lab/ref.fasta'], 'paired_end_with_extras'],
    ['paired_end', ['org/lab/ref.fasta'], 'paired_end_with_extras'],
    ['paired_end', ['org/lab/s.bam'], 'paired_end_with_extras'],
    ['single_end', ['org/lab/S_R2.FASTQ.GZ'], 'paired_end'],
    ['single_end', ['org/lab/s_r2.fq'], 'paired_end'],
    ['single_end', ['org/lab/ref.fasta'], 'single_end'],
    ['single_end', ['org/lab/s_L002_R1_001.fastq.gz'], 'single_end'],
    ['single_end', ['org/lab/s_R2_001.fastq.gz.md5'], 'single_end'],
    ['single_end', ['org/lab/s.R2.fastq.gz'], 'single_end'],
    ['paired_end', ['org/lab/s_R2_001.fastq.gz'], 'paired_end'],
    ['long_reads', ['org/lab/s_R2_001.fastq.gz', 'org/lab/ref.fasta'], 'long_reads'],
    ['paired_end_with_extras', ['org/lab/s_R2_001.fastq.gz'], 'paired_end_with_extras'],
    ['single_end', [], 'single_end'],
  ] as [SampleLayout, string[], SampleLayout][])('%s + %j -> %s', (currentLayout, addedKeys, expected) => {
    expect(upgradeLayoutForAddedFiles(currentLayout, addedKeys)).toBe(expected);
  });

  it('detects R2 through the sample SampleIdPattern, as the sheet does', () => {
    expect(upgradeLayoutForAddedFiles('single_end', ['org/lab/NA12878-2.fastq.gz'], '-')).toBe('paired_end');
    expect(upgradeLayoutForAddedFiles('single_end', ['org/lab/NA12878-2.fastq.gz'])).toBe('single_end');
  });
});

describe('reference FASTA in a custom column', () => {
  const pairedWithFastaColumn: SampleSheetColumnDef[] = [
    ...SAMPLE_SHEET_SCHEMA_PRESETS.paired,
    { columnName: 'fasta', role: 'reference_fasta', required: false },
  ];

  it.each(['A.fasta', 'A.fa', 'A.fna', 'A.fasta.gz', 'A.fa.gz', 'A.fna.gz', 'A.FA.GZ'])(
    'writes %s of a paired sample to the column',
    (fastaName) => {
      const result = buildSampleSheetFromSamples(
        pairedWithFastaColumn,
        [
          {
            SampleId: '1',
            Name: 'A',
            Layout: 'paired_end_with_extras',
            FileKeys: ['org/lab/run/A_R1.fastq.gz', 'org/lab/run/A_R2.fastq.gz', `org/lab/run/${fastaName}`],
          },
        ],
        'bucket',
      );
      expect(result).toMatchObject({
        ok: true,
        rows: [
          {
            sample: 'A',
            fastq_1: 's3://bucket/org/lab/run/A_R1.fastq.gz',
            fastq_2: 's3://bucket/org/lab/run/A_R2.fastq.gz',
            fasta: `s3://bucket/org/lab/run/${fastaName}`,
          },
        ],
      });
    },
  );

  it('upgrades a paired sample when a gzipped FASTA is added to it', () => {
    expect(upgradeLayoutForAddedFiles('paired_end', ['org/lab/run/A.fa.gz'])).toBe('paired_end_with_extras');
  });
});
