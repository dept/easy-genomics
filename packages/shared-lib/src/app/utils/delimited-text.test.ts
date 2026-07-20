import { delimiterForFilename, parseDelimitedText } from './delimited-text';

describe('parseDelimitedText', () => {
  it('returns an empty array for empty input', () => {
    expect(parseDelimitedText('')).toEqual([]);
  });

  it('parses a simple header and row', () => {
    expect(parseDelimitedText('Name,Organism\nEG-0417,E. coli')).toEqual([
      ['Name', 'Organism'],
      ['EG-0417', 'E. coli'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseDelimitedText('Name,Tags\nEG-0417,"tag1, tag2"')).toEqual([
      ['Name', 'Tags'],
      ['EG-0417', 'tag1, tag2'],
    ]);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(parseDelimitedText('Name,Note\nEG-0417,"a ""b"" c"')).toEqual([
      ['Name', 'Note'],
      ['EG-0417', 'a "b" c'],
    ]);
  });

  it('handles CRLF and LF line endings', () => {
    expect(parseDelimitedText('a,b\r\nc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('drops trailing blank lines', () => {
    expect(parseDelimitedText('a,b\nc,d\n\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('supports a tab delimiter', () => {
    expect(parseDelimitedText('a\tb\nc\td', '\t')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('delimiterForFilename', () => {
  it('returns a tab for .tsv files', () => {
    expect(delimiterForFilename('samples.tsv')).toBe('\t');
  });

  it('is case-insensitive for the .tsv extension', () => {
    expect(delimiterForFilename('SAMPLES.TSV')).toBe('\t');
  });

  it('returns a comma for .csv files', () => {
    expect(delimiterForFilename('samples.csv')).toBe(',');
  });

  it('returns a comma for .txt and unrecognized extensions', () => {
    expect(delimiterForFilename('samples.txt')).toBe(',');
    expect(delimiterForFilename('samples')).toBe(',');
  });
});
