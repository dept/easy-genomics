import { parseDelimitedText } from './delimited-text';

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
