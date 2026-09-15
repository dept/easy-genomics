import {
  dataCollectionFileKind,
  dataCollectionHiddenTypeLabel,
  fileMatchesFileTypeFilter,
  groupHiddenFilesByTypeLabel,
} from '../../../src/app/utils/data-collections-file-type';

describe('dataCollectionFileKind', () => {
  it('classifies FASTQ extensions', () => {
    expect(dataCollectionFileKind('org/lab/read1.fastq.gz')).toBe('fastq');
    expect(dataCollectionFileKind('org/lab/read2.fq.gz')).toBe('fastq');
    expect(dataCollectionFileKind('org/lab/read3.fastq')).toBe('fastq');
    expect(dataCollectionFileKind('org/lab/read4.fq')).toBe('fastq');
  });

  it('classifies FASTA extensions (.fasta before .fa)', () => {
    expect(dataCollectionFileKind('org/lab/ref.fasta')).toBe('fasta');
    expect(dataCollectionFileKind('org/lab/ref.fa')).toBe('fasta');
    expect(dataCollectionFileKind('org/lab/ref.FASTA')).toBe('fasta');
  });

  it('classifies other extensions', () => {
    expect(dataCollectionFileKind('org/lab/report.csv')).toBe('other');
    expect(dataCollectionFileKind('org/lab/summary.html')).toBe('other');
    expect(dataCollectionFileKind('org/lab/README')).toBe('other');
  });

  it('does not treat .fastq as .fa', () => {
    expect(dataCollectionFileKind('org/lab/sample.fastq')).toBe('fastq');
  });
});

describe('fileMatchesFileTypeFilter', () => {
  it('matches OR semantics across enabled kinds', () => {
    const enabled = new Set(['fastq', 'fasta'] as const);
    expect(fileMatchesFileTypeFilter('a.fastq.gz', enabled)).toBe(true);
    expect(fileMatchesFileTypeFilter('b.fasta', enabled)).toBe(true);
    expect(fileMatchesFileTypeFilter('c.csv', enabled)).toBe(false);
  });

  it('returns false when no kinds are enabled', () => {
    expect(fileMatchesFileTypeFilter('a.fastq.gz', new Set())).toBe(false);
  });
});

describe('dataCollectionHiddenTypeLabel', () => {
  it('uses multi-part suffixes when present', () => {
    expect(dataCollectionHiddenTypeLabel('org/lab/read.fastq.gz')).toBe('.fastq.gz');
    expect(dataCollectionHiddenTypeLabel('org/lab/read.fq.gz')).toBe('.fq.gz');
  });

  it('uses single extension otherwise', () => {
    expect(dataCollectionHiddenTypeLabel('org/lab/ref.fasta')).toBe('.fasta');
    expect(dataCollectionHiddenTypeLabel('org/lab/report.csv')).toBe('.csv');
  });

  it('returns fallback for extensionless basenames', () => {
    expect(dataCollectionHiddenTypeLabel('org/lab/README')).toBe('(no extension)');
  });
});

describe('groupHiddenFilesByTypeLabel', () => {
  it('pins .fastq.gz, .fasta, and .fa to the top; other labels alphabetical below', () => {
    const rows = groupHiddenFilesByTypeLabel([
      { Key: 'a.csv' },
      { Key: 'b.csv' },
      { Key: 'c.fasta' },
      { Key: 'd.html' },
      { Key: 'e.fa' },
      { Key: 'f.fastq.gz' },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['.fastq.gz', '.fasta', '.fa', '.csv', '.html']);
    expect(rows.find((r) => r.label === '.csv')?.count).toBe(2);
  });

  it('omits missing priority labels and still sorts the rest', () => {
    const rows = groupHiddenFilesByTypeLabel([{ Key: 'a.zip' }, { Key: 'b.csv' }]);
    expect(rows.map((r) => r.label)).toEqual(['.csv', '.zip']);
  });
});
