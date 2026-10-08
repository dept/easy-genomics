import {
  buildContentsSummary,
  DEFAULT_REGEX_GROUPING_PRESET_KEY,
  groupFilenamesByRegex,
  REGEX_GROUPING_PRESETS,
} from './sample-regex-grouping';

describe('groupFilenamesByRegex', () => {
  it('groups dash 1/2 pairs', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['sample-1.fastq.gz', 'sample-2.fastq.gz', 'other-1.fastq.gz'],
      REGEX_GROUPING_PRESETS.dash_1_2.pattern,
    );
    expect(unmatched).toEqual([]);
    expect(sets).toHaveLength(2);
    expect(sets[0].sampleId).toBe('other');
    expect(sets[0].status).toBe('single_end');
    expect(sets[1].sampleId).toBe('sample');
    expect(sets[1].status).toBe('paired');
  });

  it('groups underscore 1/2 pairs', () => {
    const { sets } = groupFilenamesByRegex(
      ['sample_1.fastq.gz', 'sample_2.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_1_2.pattern,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('sample');
    expect(sets[0].status).toBe('paired');
  });

  it('groups dash R1/R2 pairs', () => {
    const { sets } = groupFilenamesByRegex(
      ['sample-R1.fastq.gz', 'sample-R2.fastq.gz'],
      REGEX_GROUPING_PRESETS.dash_r1_r2.pattern,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('sample');
    expect(sets[0].status).toBe('paired');
  });

  it('groups underscore R1/R2 pairs', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['WI-0001_R1_001.fastq.gz', 'WI-0001_R2_001.fastq.gz', 'WI-0002_R1_001.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern,
    );
    expect(unmatched).toEqual([]);
    expect(sets).toHaveLength(2);
    expect(sets[0].sampleId).toBe('WI-0001');
    expect(sets[0].status).toBe('paired');
    expect(sets[1].status).toBe('single_end');
  });

  it('returns unmatched when regex fails', () => {
    const { sets, unmatched } = groupFilenamesByRegex(['bad.txt'], 'not-a-regex-[');
    expect(sets).toEqual([]);
    expect(unmatched).toEqual(['bad.txt']);
  });
});

describe('buildContentsSummary', () => {
  it('describes paired reads', () => {
    expect(
      buildContentsSummary([
        { fileName: 'a_R1.fastq.gz', role: 'read1' },
        { fileName: 'a_R2.fastq.gz', role: 'read2' },
      ]),
    ).toBe('2 files · R1 + R2');
  });

  it('describes paired reads with reference FASTA for paired_end_with_extras', () => {
    expect(
      buildContentsSummary([
        { fileName: 'a_R1.fastq.gz', role: 'read1' },
        { fileName: 'a_R2.fastq.gz', role: 'read2' },
        { fileName: 'ref.fasta', role: 'reference_fasta' },
      ]),
    ).toBe('3 files · R1 + R2 + ref');
  });
});

describe('groupFilenamesByRegex case-insensitivity', () => {
  it('matches an uppercase extension and a lowercase read token under an existing preset', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['CA-IL-260806_R1_001.FASTQ.GZ', 'CA-IL-260806_r2_001.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern,
    );
    expect(unmatched).toEqual([]);
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('CA-IL-260806');
    expect(sets[0].files.map((f) => f.role)).toEqual(['read1', 'read2']);
    expect(sets[0].status).toBe('paired');
  });

  it('honours a custom regex verbatim and still reads its named groups', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['ABC.r1.fq', 'ABC.R2.fq', 'notes.txt'],
      '(?<sample>[a-z]+)\\.(?<read>R[12])\\.fq',
    );
    expect(unmatched).toEqual(['notes.txt']);
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('ABC');
    expect(sets[0].files.map((f) => f.role)).toEqual(['read1', 'read2']);
  });

  it('still reports an invalid custom regex as all-unmatched', () => {
    const { sets, unmatched } = groupFilenamesByRegex(['a_R1.fastq.gz'], '(?<sample>[');
    expect(sets).toEqual([]);
    expect(unmatched).toEqual(['a_R1.fastq.gz']);
  });
});

describe('existing presets after widening', () => {
  const firstMatch = (pattern: string, fileName: string) => {
    const { sets } = groupFilenamesByRegex([fileName], pattern);
    return sets.length ? { sampleId: sets[0].sampleId, role: sets[0].files[0].role } : undefined;
  };

  it.each([
    ['S_R1_001.fq.gz', 'read1'],
    ['S_R2.fastq', 'read2'],
    ['S_R1_.fq', 'read1'],
    ['S_R1_002.fastq.gz', 'read1'],
  ])('_R1 and _R2 accepts %s', (fileName, role) => {
    expect(firstMatch(REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern, fileName)).toEqual({ sampleId: 'S', role });
  });

  it('matches the trailing-separator files from the dev reproduction', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['ZRXSXL_R1_.fastq.gz', 'ZRXSXL_R2_.fastq.gz', 'IRRGTLK_R2_.fastq', '0FALKI_R1_002.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern,
    );
    expect(unmatched).toEqual([]);
    expect(sets.map((s) => s.sampleId)).toEqual(['0FALKI', 'IRRGTLK', 'ZRXSXL']);
    expect(sets[2].status).toBe('paired');
  });

  it.each([
    ['dash_1_2', 'sample-1.fastq.gz', 'sample', 'read1'],
    ['dash_1_2', 'other-1.fastq.gz', 'other', 'read1'],
    ['underscore_1_2', 'sample_2.fastq.gz', 'sample', 'read2'],
    ['underscore_1_2', 'A_1_B_2.fastq.gz', 'A_1_B', 'read2'],
    ['dash_r1_r2', 'sample-R2.fastq.gz', 'sample', 'read2'],
    ['dash_r1_r2', 'a-b_c-R2_001.fastq.gz', 'a-b_c', 'read2'],
    ['underscore_r1_r2', 'WI-0001_R1_001.fastq.gz', 'WI-0001', 'read1'],
    ['underscore_r1_r2', 'CA-IL-260806_S1_L001_R1_001.fastq.gz', 'CA-IL-260806_S1_L001', 'read1'],
    ['underscore_r1_r2', 'Undetermined_S0_L001_R1_001.fastq.gz', 'Undetermined_S0_L001', 'read1'],
  ] as const)("%s keeps today's result for %s", (presetKey, fileName, sampleId, role) => {
    expect(firstMatch(REGEX_GROUPING_PRESETS[presetKey].pattern, fileName)).toEqual({ sampleId, role });
  });

  it('_1 and _2 leaves an Illumina name with an earlier _2 unmatched rather than misreading it', () => {
    const { unmatched } = groupFilenamesByRegex(
      ['sample_2_S2_L001_R1_001.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_1_2.pattern,
    );
    expect(unmatched).toEqual(['sample_2_S2_L001_R1_001.fastq.gz']);
  });
});

describe('default any-separator preset', () => {
  const defaultPattern = () => REGEX_GROUPING_PRESETS[DEFAULT_REGEX_GROUPING_PRESET_KEY].pattern;

  it('is the separator-agnostic preset and is listed first', () => {
    expect(DEFAULT_REGEX_GROUPING_PRESET_KEY).toBe('any_separator_r1_r2');
    expect(REGEX_GROUPING_PRESETS.any_separator_r1_r2.label).toBe('R1 and R2 (any separator)');
    expect(Object.keys(REGEX_GROUPING_PRESETS)[0]).toBe('any_separator_r1_r2');
  });

  it('pairs underscore- and dash-separated samples from one bucket', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      [
        'FHKL-LB-0012_R1_001.fastq.gz',
        'FHKL-LB-0012_R2_001.fastq.gz',
        'WI-0001-R1_001.fastq.gz',
        'WI-0001-R2_001.fastq.gz',
      ],
      defaultPattern(),
    );
    expect(unmatched).toEqual([]);
    expect(sets.map((s) => [s.sampleId, s.status])).toEqual([
      ['FHKL-LB-0012', 'paired'],
      ['WI-0001', 'paired'],
    ]);
  });

  it('takes the last read token, so a sample number before it stays in the sample ID', () => {
    const { sets } = groupFilenamesByRegex(
      ['sample_2_S2_L001_R1_001.fastq.gz', 'sample_2_S2_L001_R2_001.fastq.gz'],
      defaultPattern(),
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('sample_2_S2_L001');
    expect(sets[0].files.map((f) => f.role)).toEqual(['read1', 'read2']);
  });

  it.each([
    ['ZRXSXL_R1_.fastq.gz', 'ZRXSXL', 'read1'],
    ['0FALKI_R1_002.fastq.gz', '0FALKI', 'read1'],
    ['IRRGTLK_R2_.fastq', 'IRRGTLK', 'read2'],
    ['CA-IL-260806_R1_001.fq.gz', 'CA-IL-260806', 'read1'],
    ['S1.R2.FQ.GZ', 'S1', 'read2'],
  ])('groups %s', (fileName, sampleId, role) => {
    const { sets } = groupFilenamesByRegex([fileName], defaultPattern());
    expect(sets.map((s) => [s.sampleId, s.files[0].role])).toEqual([[sampleId, role]]);
  });

  it('leaves bare-number files to the _1/_2 presets', () => {
    const fileNames = ['SAMPLE-2.fastq.gz', 'sample_1.fastq.gz'];
    const { sets, unmatched } = groupFilenamesByRegex(fileNames, defaultPattern());
    expect(sets).toEqual([]);
    expect(unmatched).toEqual(fileNames);
  });

  it('leaves non-FASTQ files, sidecars and Illumina sample-number names unmatched', () => {
    const fileNames = ['samplesheet-1.csv', 'x_R1_001.fastq.gz.md5', 'ZRXSXL_S1_.fastq.gz', 'ZRXSXL_S2_.fastq.gz'];
    const { sets, unmatched } = groupFilenamesByRegex(fileNames, defaultPattern());
    expect(sets).toEqual([]);
    expect(unmatched).toEqual(fileNames);
  });
});

describe('groupFilenamesByRegex across folders', () => {
  const pattern = REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern;

  it('keeps same-named samples in different folders apart', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      [
        'org/lab/aws-healthomics/txn-a/ZRXSXL_R1_001.fastq.gz',
        'org/lab/aws-healthomics/txn-a/ZRXSXL_R2_001.fastq.gz',
        'org/lab/aws-healthomics/txn-b/ZRXSXL_R1_001.fastq.gz',
        'org/lab/aws-healthomics/txn-b/ZRXSXL_R2_001.fastq.gz',
      ],
      pattern,
    );
    expect(unmatched).toEqual([]);
    expect(sets.map((s) => s.sampleId)).toEqual(['ZRXSXL', 'ZRXSXL']);
    expect(sets.map((s) => s.folder)).toEqual(['org/lab/aws-healthomics/txn-a/', 'org/lab/aws-healthomics/txn-b/']);
    expect(sets.map((s) => s.groupKey)).toEqual([
      'org/lab/aws-healthomics/txn-a/ZRXSXL',
      'org/lab/aws-healthomics/txn-b/ZRXSXL',
    ]);
    expect(sets.map((s) => s.files.length)).toEqual([2, 2]);
    expect(sets.map((s) => s.status)).toEqual(['paired', 'paired']);
    expect(sets.map((s) => s.layout)).toEqual(['paired_end', 'paired_end']);
  });

  it('splits the dev-site reproduction into one paired sample per folder (34 folders x 2 files)', () => {
    const folders = Array.from({ length: 34 }, (_, i) => `org/lab/aws-healthomics/txn-${String(i).padStart(2, '0')}/`);
    const fileNames = folders.flatMap((folder) => [
      `${folder}ZRXSXL_R1_001.fastq.gz`,
      `${folder}ZRXSXL_R2_001.fastq.gz`,
    ]);
    const { sets, unmatched } = groupFilenamesByRegex(fileNames, pattern);
    expect(unmatched).toEqual([]);
    expect(sets).toHaveLength(34);
    expect(sets.map((s) => s.folder)).toEqual(folders);
    for (const set of sets) {
      expect(set.sampleId).toBe('ZRXSXL');
      expect(set.status).toBe('paired');
      expect(set.files.map((f) => f.role)).toEqual(['read1', 'read2']);
    }
  });

  it('still pairs R1 and R2 inside one folder', () => {
    const { sets } = groupFilenamesByRegex(
      ['org/lab/run-1/S1_R1_001.fastq.gz', 'org/lab/run-1/S1_R2_001.fastq.gz'],
      pattern,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('S1');
    expect(sets[0].folder).toBe('org/lab/run-1/');
    expect(sets[0].status).toBe('paired');
    expect(sets[0].files.map((f) => f.fileName)).toEqual([
      'org/lab/run-1/S1_R1_001.fastq.gz',
      'org/lab/run-1/S1_R2_001.fastq.gz',
    ]);
  });

  it('groups bare file names (the upload source) with an empty folder, as before', () => {
    const { sets } = groupFilenamesByRegex(['S1_R1_001.fastq.gz', 'S1_R2_001.fastq.gz', 'S2_R1_001.fastq.gz'], pattern);
    expect(sets.map((s) => s.sampleId)).toEqual(['S1', 'S2']);
    expect(sets.map((s) => s.folder)).toEqual(['', '']);
    expect(sets.map((s) => s.groupKey)).toEqual(['S1', 'S2']);
    expect(sets.map((s) => s.status)).toEqual(['paired', 'single_end']);
  });

  it('orders same-named samples by folder so they sit next to each other', () => {
    const { sets } = groupFilenamesByRegex(['b/X_R1.fastq.gz', 'a/Y_R1.fastq.gz', 'a/X_R1.fastq.gz'], pattern);
    expect(sets.map((s) => s.groupKey)).toEqual(['a/X', 'b/X', 'a/Y']);
  });
});
