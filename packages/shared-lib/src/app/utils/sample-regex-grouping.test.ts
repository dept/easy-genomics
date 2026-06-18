import { buildContentsSummary, groupFilenamesByRegex, REGEX_GROUPING_PRESETS } from './sample-regex-grouping';

describe('groupFilenamesByRegex', () => {
  it('groups underscore R1/R2 pairs', () => {
    const { sets, unmatched } = groupFilenamesByRegex(
      ['WI-0001_R1_001.fastq.gz', 'WI-0001_R2_001.fastq.gz', 'WI-0002_R1_001.fastq.gz'],
      REGEX_GROUPING_PRESETS.underscore_r1_r2,
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

  it('groups dot R1/R2 pairs', () => {
    const { sets } = groupFilenamesByRegex(
      ['sample.R1.fastq.gz', 'sample.R2.fastq.gz'],
      REGEX_GROUPING_PRESETS.dot_r1_r2,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sampleId).toBe('sample');
    expect(sets[0].status).toBe('paired');
  });

  it('groups illumina lane pairs', () => {
    const { sets } = groupFilenamesByRegex(
      ['sample_S1_L001_R1_001.fastq.gz', 'sample_S1_L001_R2_001.fastq.gz'],
      REGEX_GROUPING_PRESETS.illumina_lane,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].status).toBe('paired');
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
