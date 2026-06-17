import {
  parseSelectionKey,
  selectionFromLegacyKeys,
  selectionHasOnlyFiles,
  selectionHasOnlySequenceSets,
  selectedFileKeys,
  toggleSelectionItem,
} from '../../../src/app/utils/data-collections-selection';

describe('data-collections-selection', () => {
  it('toggleSelectionItem adds and removes items', () => {
    let sel = toggleSelectionItem([], { type: 'file', key: 'a' });
    expect(sel).toHaveLength(1);
    sel = toggleSelectionItem(sel, { type: 'file', key: 'a' });
    expect(sel).toHaveLength(0);
  });

  it('selectionHasOnlyFiles rejects mixed selection', () => {
    const sel = [
      { type: 'file' as const, key: 'a' },
      { type: 'sequenceSet' as const, sequenceSetId: 's1' },
    ];
    expect(selectionHasOnlyFiles(sel)).toBe(false);
    expect(selectionHasOnlySequenceSets(sel)).toBe(false);
    expect(selectedFileKeys(sel)).toEqual(['a']);
  });

  it('parseSelectionKey handles legacy bare S3 keys', () => {
    expect(parseSelectionKey('org/lab/sample.fastq.gz')).toEqual({
      type: 'file',
      key: 'org/lab/sample.fastq.gz',
    });
  });

  it('selectionFromLegacyKeys converts bare keys to file selections', () => {
    expect(selectionFromLegacyKeys(['org/lab/a.fq.gz', 'org/lab/b.fq.gz'])).toEqual([
      { type: 'file', key: 'org/lab/a.fq.gz' },
      { type: 'file', key: 'org/lab/b.fq.gz' },
    ]);
  });

  it('selectionHasOnlyFiles returns true for file-only selections', () => {
    expect(selectionHasOnlyFiles([{ type: 'file', key: 'a' }])).toBe(true);
  });
});
