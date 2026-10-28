import { isFilenameRegexSafe } from './filename-regex-safety';
import {
  buildContentsSummary,
  DEFAULT_REGEX_GROUPING_PRESET_KEY,
  FASTA_REGEX_GROUPING_PRESET_KEY,
  findDuplicateSampleNames,
  findSharedFasta,
  folderBelowLabRoot,
  groupFilenamesByRegex,
  hasFastaButNoFastq,
  isFastq,
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

describe('findDuplicateSampleNames', () => {
  const pattern = REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern;

  it('reports a name proposed from two folders, with both folders', () => {
    const { sets } = groupFilenamesByRegex(
      ['run-b/ZRXSXL_R1.fastq.gz', 'run-a/ZRXSXL_R1.fastq.gz', 'run-a/OTHER_R1.fastq.gz'],
      pattern,
    );
    expect(findDuplicateSampleNames(sets)).toEqual([{ sampleId: 'ZRXSXL', folders: ['run-a/', 'run-b/'] }]);
  });

  it('reports nothing once the user has excluded all but one of the repeats', () => {
    const { sets } = groupFilenamesByRegex(['run-a/ZRXSXL_R1.fastq.gz', 'run-b/ZRXSXL_R1.fastq.gz'], pattern);
    const active = sets.filter((s) => s.groupKey !== 'run-b/ZRXSXL');
    expect(findDuplicateSampleNames(active)).toEqual([]);
  });

  it('reports nothing for bare file names, which cannot repeat', () => {
    const { sets } = groupFilenamesByRegex(['S1_R1.fastq.gz', 'S1_R2.fastq.gz', 'S2_R1.fastq.gz'], pattern);
    expect(findDuplicateSampleNames(sets)).toEqual([]);
  });

  it('treats names that differ only in case as the same name', () => {
    const { sets } = groupFilenamesByRegex(['run-a/ZRXSXL_R1.fastq.gz', 'run-b/zrxsxl_R1.fastq.gz'], pattern);
    const duplicates = findDuplicateSampleNames(sets);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].sampleId.toLowerCase()).toBe('zrxsxl');
    expect(duplicates[0].folders.sort()).toEqual(['run-a/', 'run-b/']);
  });
});

describe('folderBelowLabRoot', () => {
  it('strips the leading organization and laboratory segments', () => {
    expect(folderBelowLabRoot('org-1/lab-1/aws-healthomics/txn-a/')).toBe('aws-healthomics/txn-a/');
  });

  it('returns an empty string for the lab root and for bare file names', () => {
    expect(folderBelowLabRoot('org-1/lab-1/')).toBe('');
    expect(folderBelowLabRoot('')).toBe('');
  });
});

describe('sidecar files under every preset', () => {
  const presetFixtures = [
    ['any_separator_r1_r2', 'x_R1_001.fastq.gz', 'x'],
    ['underscore_r1_r2', 'x_R1_001.fastq.gz', 'x'],
    ['dash_r1_r2', 'x-R1_001.fastq.gz', 'x'],
    ['underscore_1_2', 'x_1.fq.gz', 'x'],
    ['dash_1_2', 'x-2.fastq', 'x'],
  ] as const;
  const sidecarSuffixes = ['.md5', '.sha256', '.tmp', '.bak'];

  it.each(presetFixtures)('%s still matches %s as sample %s', (presetKey, fastqName, sampleId) => {
    const { sets, unmatched } = groupFilenamesByRegex([fastqName], REGEX_GROUPING_PRESETS[presetKey].pattern);
    expect(unmatched).toEqual([]);
    expect(sets.map((set) => set.sampleId)).toEqual([sampleId]);
  });

  it.each(presetFixtures)('%s leaves sidecars of %s unmatched', (presetKey, fastqName) => {
    const sidecars = sidecarSuffixes.map((suffix) => `${fastqName}${suffix}`);
    const { sets, unmatched } = groupFilenamesByRegex(
      [fastqName, ...sidecars],
      REGEX_GROUPING_PRESETS[presetKey].pattern,
    );
    expect(unmatched).toEqual(sidecars);
    expect(sets).toHaveLength(1);
    expect(sets[0].files).toHaveLength(1);
  });

  it('keeps an upper-case extension matching', () => {
    const { unmatched } = groupFilenamesByRegex(['x_R1_001.FASTQ.GZ'], REGEX_GROUPING_PRESETS.underscore_r1_r2.pattern);
    expect(unmatched).toEqual([]);
  });
});

describe('reference FASTA role', () => {
  const customPattern = '^(?<sample>[^_]+)_(?:(?<read>R[12])_001\\.fastq\\.gz|ref\\.[a-z0-9.]+)$';

  it.each(['ref.fa', 'ref.fasta', 'ref.fna', 'ref.fa.gz', 'ref.fasta.gz', 'ref.fna.gz', 'ref.FA.GZ'])(
    'gives %s the reference_fasta role and a paired_end_with_extras layout',
    (referenceName) => {
      const { sets } = groupFilenamesByRegex(
        ['s1_R1_001.fastq.gz', 's1_R2_001.fastq.gz', `s1_${referenceName}`],
        customPattern,
      );
      expect(sets).toHaveLength(1);
      expect(sets[0].files.find((f) => f.fileName === `s1_${referenceName}`)?.role).toBe('reference_fasta');
      expect(sets[0].layout).toBe('paired_end_with_extras');
    },
  );

  it.each(['ref.fa.gz.md5', 'ref.fai'])('does not treat %s as a reference', (sidecarName) => {
    const { sets } = groupFilenamesByRegex(['s1_R1_001.fastq.gz', `s1_${sidecarName}`], customPattern);
    expect(sets[0].files.find((f) => f.fileName === `s1_${sidecarName}`)?.role).toBe('extra');
  });
});

describe('FASTA-only samples', () => {
  const fastaPattern = REGEX_GROUPING_PRESETS.fasta_one_per_file.pattern;

  it('offers the preset after the default one', () => {
    expect(REGEX_GROUPING_PRESETS.fasta_one_per_file.label).toBe('One sample per FASTA file');
    expect(Object.keys(REGEX_GROUPING_PRESETS)[0]).toBe(DEFAULT_REGEX_GROUPING_PRESET_KEY);
  });

  it('passes the filename regex safety check', () => {
    expect(isFilenameRegexSafe(fastaPattern)).toBe(true);
  });

  it.each([
    ['WI-01.fa', 'WI-01'],
    ['WI-01.fasta', 'WI-01'],
    ['WI-01.fna', 'WI-01'],
    ['WI-01.fa.gz', 'WI-01'],
    ['WI-01.contigs.FASTA.GZ', 'WI-01.contigs'],
  ])('groups %s as assembled sample %s', (fileName, sampleId) => {
    const { sets, unmatched } = groupFilenamesByRegex([`org/lab/genomes/${fileName}`], fastaPattern);
    expect(unmatched).toEqual([]);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ sampleId, status: 'assembled', layout: 'assembled' });
  });

  it('makes one sample per FASTA file', () => {
    const { sets } = groupFilenamesByRegex(
      ['org/lab/genomes/a.fasta', 'org/lab/genomes/b.fa', 'org/lab/genomes/c.fna', 'org/lab/genomes/d.fa.gz'],
      fastaPattern,
    );
    expect(sets.map((set) => set.sampleId)).toEqual(['a', 'b', 'c', 'd']);
    expect(sets.every((set) => set.layout === 'assembled' && set.files.length === 1)).toBe(true);
  });

  it.each(['WI-01.fa.gz.md5', 'WI-01.fai', 'WI-01_R1.fastq.gz'])('leaves %s unmatched', (fileName) => {
    const { sets, unmatched } = groupFilenamesByRegex([fileName], fastaPattern);
    expect(sets).toEqual([]);
    expect(unmatched).toEqual([fileName]);
  });

  it('marks a FASTA-only group from a custom regex assembled', () => {
    const { sets } = groupFilenamesByRegex(['org/lab/genomes/WI-01.fasta'], '(?<sample>.+)\\.fasta$');
    expect(sets[0]).toMatchObject({ status: 'assembled', layout: 'assembled' });
  });

  it('keeps an R1 plus a FASTA single_end', () => {
    const { sets } = groupFilenamesByRegex(
      ['s1_R1.fastq.gz', 's1_ref.fa'],
      '^(?<sample>[^_]+)_(?:(?<read>R[12])\\.fastq\\.gz|ref\\.fa)$',
    );
    expect(sets[0]).toMatchObject({ status: 'single_end', layout: 'single_end' });
  });
});

describe('listings without FASTQ', () => {
  const fastaPattern = REGEX_GROUPING_PRESETS[FASTA_REGEX_GROUPING_PRESET_KEY].pattern;

  it('names the FASTA preset', () => {
    expect(REGEX_GROUPING_PRESETS[FASTA_REGEX_GROUPING_PRESET_KEY].label).toBe('One sample per FASTA file');
  });

  it.each(['a.fastq.gz', 'a.fq.gz', 'a.fastq', 'a.fq', 'A_R1.FASTQ.GZ'])('treats %s as FASTQ', (fileName) => {
    expect(isFastq(fileName)).toBe(true);
  });

  it.each(['a.fastq.gz.md5', 'a.fq.gz.sha256', 'a.fasta', 'a.bam', 'a.fastqc.html'])(
    'does not treat %s as FASTQ',
    (fileName) => {
      expect(isFastq(fileName)).toBe(false);
    },
  );

  it.each([
    { listing: 'FASTA only', fileNames: ['org/lab/g/WI-01.fasta', 'org/lab/g/WI-02.fa.gz'], expected: true },
    {
      listing: 'FASTA with index and checksum files',
      fileNames: ['org/lab/g/WI-01.fasta', 'org/lab/g/WI-01.fasta.fai', 'org/lab/g/WI-01.fasta.md5'],
      expected: true,
    },
    {
      listing: 'FASTA with a FASTQ checksum but no FASTQ',
      fileNames: ['org/lab/g/WI-01.fa', 'org/lab/g/x_R1.fastq.gz.md5'],
      expected: true,
    },
    { listing: 'FASTA and FASTQ', fileNames: ['org/lab/g/ref.fa', 'org/lab/g/x_R1.fastq.gz'], expected: false },
    {
      listing: 'FASTA and an upper-case FASTQ',
      fileNames: ['org/lab/g/ref.fa', 'org/lab/g/X_R1.FASTQ.GZ'],
      expected: false,
    },
    {
      listing: 'FASTQ only',
      fileNames: ['org/lab/g/x_R1.fastq.gz', 'org/lab/g/x_R2.fastq.gz'],
      expected: false,
    },
    { listing: 'BAM only', fileNames: ['org/lab/g/x.bam', 'org/lab/g/x.bam.bai'], expected: false },
    { listing: 'nothing', fileNames: [], expected: false },
  ])('hasFastaButNoFastq is $expected for $listing', ({ fileNames, expected }) => {
    expect(hasFastaButNoFastq(fileNames)).toBe(expected);
  });

  it('groups such a listing one sample per FASTA file and leaves the rest unmatched', () => {
    const listing = [
      'org/lab/genomes/WI-01.fasta',
      'org/lab/genomes/WI-01.fasta.fai',
      'org/lab/genomes/WI-02.fa.gz',
      'org/lab/genomes/WI-02.fa.gz.md5',
      'org/lab/genomes/WI-03.fna',
      'org/lab/genomes/WI-03.bam',
      'org/lab/genomes/README.txt',
    ];
    expect(hasFastaButNoFastq(listing)).toBe(true);
    const { sets, unmatched } = groupFilenamesByRegex(listing, fastaPattern);
    expect(sets.map((set) => [set.sampleId, set.files.length, set.layout, set.status])).toEqual([
      ['WI-01', 1, 'assembled', 'assembled'],
      ['WI-02', 1, 'assembled', 'assembled'],
      ['WI-03', 1, 'assembled', 'assembled'],
    ]);
    expect(unmatched).toEqual([
      'org/lab/genomes/WI-01.fasta.fai',
      'org/lab/genomes/WI-02.fa.gz.md5',
      'org/lab/genomes/WI-03.bam',
      'org/lab/genomes/README.txt',
    ]);
  });

  it('keeps two FASTA files with the same stem in one folder as one sample', () => {
    const { sets } = groupFilenamesByRegex(['org/lab/genomes/WI-01.fa', 'org/lab/genomes/WI-01.fa.gz'], fastaPattern);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ sampleId: 'WI-01', layout: 'assembled', status: 'assembled' });
    expect(sets[0].files).toHaveLength(2);
  });
});

describe('FASTA next to FASTQ reads', () => {
  const defaultPattern = REGEX_GROUPING_PRESETS[DEFAULT_REGEX_GROUPING_PRESET_KEY].pattern;
  const pairs = [
    'org/lab/run/A_R1.fastq.gz',
    'org/lab/run/A_R2.fastq.gz',
    'org/lab/run/B_R1.fastq.gz',
    'org/lab/run/B_R2.fastq.gz',
  ];

  it('case 1: keeps a FASTA named after no sample out of every sample', () => {
    const listing = [...pairs, 'org/lab/run/ref.fa'];
    const { sets, unmatched } = groupFilenamesByRegex(listing, defaultPattern);
    expect(sets.map((set) => [set.sampleId, set.files.length, set.layout, set.status])).toEqual([
      ['A', 2, 'paired_end', 'paired'],
      ['B', 2, 'paired_end', 'paired'],
    ]);
    expect(unmatched).toEqual(['org/lab/run/ref.fa']);
    expect(findSharedFasta(listing, unmatched)).toEqual(['org/lab/run/ref.fa']);
  });

  it('case 2: puts each FASTA in the read pair it is named after', () => {
    const listing = [...pairs, 'org/lab/run/A.fasta', 'org/lab/run/B.fa.gz'];
    const { sets, unmatched } = groupFilenamesByRegex(listing, defaultPattern);
    expect(sets.map((set) => [set.sampleId, set.layout, set.status])).toEqual([
      ['A', 'paired_end_with_extras', 'paired'],
      ['B', 'paired_end_with_extras', 'paired'],
    ]);
    expect(sets[0].files).toEqual([
      { fileName: 'org/lab/run/A_R1.fastq.gz', role: 'read1' },
      { fileName: 'org/lab/run/A_R2.fastq.gz', role: 'read2' },
      { fileName: 'org/lab/run/A.fasta', role: 'reference_fasta' },
    ]);
    expect(unmatched).toEqual([]);
    expect(findSharedFasta(listing, unmatched)).toEqual([]);
  });

  it('handles both cases in one listing without being told which', () => {
    const listing = [...pairs, 'org/lab/run/A.fasta', 'org/lab/run/ref.fa'];
    const { sets, unmatched } = groupFilenamesByRegex(listing, defaultPattern);
    expect(sets.map((set) => [set.sampleId, set.layout])).toEqual([
      ['A', 'paired_end_with_extras'],
      ['B', 'paired_end'],
    ]);
    expect(unmatched).toEqual(['org/lab/run/ref.fa']);
  });

  it('pairs bare upload names the same way', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['A_R1.fastq.gz', 'A_R2.fastq.gz', 'A.fna', 'ref.fna'],
      defaultPattern,
    );
    expect(sets[0]).toMatchObject({ sampleId: 'A', layout: 'paired_end_with_extras' });
    expect(sets[0].files).toHaveLength(3);
    expect(unmatched).toEqual(['ref.fna']);
  });

  it('puts every FASTA with the sample name in the sample', () => {
    const { sets } = groupFilenamesByRegex([...pairs, 'org/lab/run/A.fasta', 'org/lab/run/A.fa.gz'], defaultPattern);
    expect(sets[0].files).toHaveLength(4);
  });

  it.each([
    ['an upper-case extension', 'org/lab/run/A.FASTA.GZ', true],
    ['a name with a suffix', 'org/lab/run/A.contigs.fa', false],
    ['a name in another letter case', 'org/lab/run/a.fasta', false],
    ['another folder', 'org/lab/run/assemblies/A.fasta', false],
  ])('a FASTA with %s joins sample A: %s', (_case, fastaKey, joins) => {
    const { sets, unmatched } = groupFilenamesByRegex([...pairs, fastaKey], defaultPattern);
    expect(sets[0].files.some((file) => file.fileName === fastaKey)).toBe(joins);
    expect(unmatched.includes(fastaKey)).toBe(!joins);
  });

  it('keeps a FASTA shared when the reads carry an Illumina suffix, because the sample ID is longer', () => {
    const listing = [
      'org/lab/run/A_S1_L001_R1_001.fastq.gz',
      'org/lab/run/A_S1_L001_R2_001.fastq.gz',
      'org/lab/run/A.fasta',
    ];
    const { sets, unmatched } = groupFilenamesByRegex(listing, defaultPattern);
    expect(sets[0]).toMatchObject({ sampleId: 'A_S1_L001', layout: 'paired_end' });
    expect(findSharedFasta(listing, unmatched)).toEqual(['org/lab/run/A.fasta']);
  });

  it('keeps a same-name FASTA out of a single-end sample, whose sheet row has no FASTA column', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['org/lab/run/A_R1.fastq.gz', 'org/lab/run/A.fasta'],
      defaultPattern,
    );
    expect(sets[0]).toMatchObject({ sampleId: 'A', layout: 'single_end' });
    expect(sets[0].files).toHaveLength(1);
    expect(unmatched).toEqual(['org/lab/run/A.fasta']);
  });

  it('never counts a FASTA index or checksum as shared', () => {
    const listing = [...pairs, 'org/lab/run/A.fasta.fai', 'org/lab/run/ref.fa.md5'];
    const { unmatched } = groupFilenamesByRegex(listing, defaultPattern);
    expect(unmatched).toEqual(['org/lab/run/A.fasta.fai', 'org/lab/run/ref.fa.md5']);
    expect(findSharedFasta(listing, unmatched)).toEqual([]);
  });

  it('finds no shared FASTA in a listing without FASTQ', () => {
    const listing = ['org/lab/g/WI-01.fasta', 'org/lab/g/WI-02.fa'];
    expect(findSharedFasta(listing, listing)).toEqual([]);
  });
});
