import { buildContentsSummary, groupFilenamesByRegex, REGEX_GROUPING_PRESETS } from './sample-regex-grouping';

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
