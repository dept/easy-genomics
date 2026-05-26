import { getSampleGroupId } from '../../../src/app/utils/data-collections-to-sample-sheet';

describe('getSampleGroupId', () => {
  it('groups multi-lane paired reads under the same sample id', () => {
    expect(getSampleGroupId('WI-Jan-2024-S005_L001_R1_001.fastq.gz')).toBe('WI-Jan-2024-S005');
    expect(getSampleGroupId('WI-Jan-2024-S005_L001_R2_001.fastq.gz')).toBe('WI-Jan-2024-S005');
    expect(getSampleGroupId('WI-Jan-2024-S005_L002_R1_001.fastq.gz')).toBe('WI-Jan-2024-S005');
    expect(getSampleGroupId('WI-Jan-2024-S005_L002_R2_001.fastq.gz')).toBe('WI-Jan-2024-S005');
  });

  it('handles single-lane paired reads (no _L<digits>)', () => {
    expect(getSampleGroupId('Jan-2024-S001_R1_001.fastq.gz')).toBe('Jan-2024-S001');
    expect(getSampleGroupId('Jan-2024-S001_R2_001.fastq.gz')).toBe('Jan-2024-S001');
  });

  it('handles paired reads with no trailing set number', () => {
    expect(getSampleGroupId('SampleA_R1.fastq')).toBe('SampleA');
    expect(getSampleGroupId('SampleA_R2.fastq.gz')).toBe('SampleA');
  });

  it('handles .fq and .fq.gz extensions', () => {
    expect(getSampleGroupId('SampleA_R2_001.fq.gz')).toBe('SampleA');
    expect(getSampleGroupId('SampleA_R1_001.fq')).toBe('SampleA');
  });

  it('is case-insensitive on the R direction marker', () => {
    expect(getSampleGroupId('SampleA_r1_001.fastq.gz')).toBe('SampleA');
    expect(getSampleGroupId('SampleA_r2_001.fastq.gz')).toBe('SampleA');
  });

  it('returns null for files that are not paired reads', () => {
    expect(getSampleGroupId('multiqc_report.html')).toBeNull();
    expect(getSampleGroupId('notes.txt')).toBeNull();
    expect(getSampleGroupId('reference_genome_hg38.fasta')).toBeNull();
  });

  it('returns null for index reads (_I1, _I2) — they stay solo', () => {
    expect(getSampleGroupId('SampleA_I1_001.fastq.gz')).toBeNull();
    expect(getSampleGroupId('SampleA_L001_I2_001.fastq.gz')).toBeNull();
  });

  it('returns null when a lane is present but no R direction follows', () => {
    expect(getSampleGroupId('Sample_L01_extra.fastq.gz')).toBeNull();
  });

  it('only consumes _L<digits> when it directly precedes _R[12]', () => {
    // Lane is part of the sample name, not the lane suffix — keep it in the group id.
    expect(getSampleGroupId('Lib_L99_thing_R1_001.fastq.gz')).toBe('Lib_L99_thing');
  });
});
