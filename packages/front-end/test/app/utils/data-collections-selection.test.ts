import {
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
});
