import { buildContentsSummary, groupFilenamesByRegex, REGEX_GROUPING_PRESETS } from './sequence-set-regex-grouping';

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
});
