import {
  canZipAllKeyOutputs,
  isKeyOutputRoleTruncated,
  uniqueKeyOutputObjectKeys,
} from './workflow-key-output-download';

describe('key output zip selection', () => {
  it('de-duplicates keys that match more than one role', () => {
    expect(
      uniqueKeyOutputObjectKeys([
        { Matches: [{ Key: 'a.html' }, { Key: 'b.html' }] },
        { Matches: [{ Key: 'b.html' }, { Key: 'c.html' }] },
      ]),
    ).toEqual(['a.html', 'b.html', 'c.html']);
  });

  it('treats a role as truncated when MatchCount exceeds the returned files', () => {
    expect(isKeyOutputRoleTruncated({ MatchCount: 1001, Matches: new Array(1000) })).toBe(true);
    expect(isKeyOutputRoleTruncated({ MatchCount: 2, Matches: [{}, {}] })).toBe(false);
  });

  it('allows a zip of 2000 unique keys and rejects 2001 or a truncated role', () => {
    const atLimit = [
      { MatchCount: 2000, Matches: Array.from({ length: 2000 }, (_unused, index) => ({ Key: `${index}` })) },
    ];
    const overLimit = [
      { MatchCount: 2001, Matches: Array.from({ length: 2001 }, (_unused, index) => ({ Key: `${index}` })) },
    ];
    const truncated = [{ MatchCount: 5, Matches: [{ Key: 'only-one' }] }];

    expect(canZipAllKeyOutputs(atLimit, 2000)).toBe(true);
    expect(canZipAllKeyOutputs(overLimit, 2000)).toBe(false);
    expect(canZipAllKeyOutputs(truncated, 2000)).toBe(false);
  });
});
