import { countFullyProtectedRuns, formatRetentionMonthsLabel } from '../../../src/app/utils/lab-storage-display';

describe('formatRetentionMonthsLabel', () => {
  it('returns Never for 0', () => {
    expect(formatRetentionMonthsLabel(0)).toBe('Never');
  });

  it('singularizes 1 month', () => {
    expect(formatRetentionMonthsLabel(1)).toBe('1 month');
  });

  it('pluralizes other month counts', () => {
    expect(formatRetentionMonthsLabel(6)).toBe('6 months');
  });
});

describe('countFullyProtectedRuns', () => {
  it('counts unique RunIds, not items', () => {
    expect(
      countFullyProtectedRuns([
        { RunId: 'r1', FileCount: 2, ProtectedFileCount: 2 },
        { RunId: 'r1', FileCount: 1, ProtectedFileCount: 1 },
        { RunId: 'r1', FileCount: 3, ProtectedFileCount: 3 },
      ]),
    ).toBe(1);
  });

  it('ignores partial protection and unattached items', () => {
    expect(
      countFullyProtectedRuns([
        { RunId: 'r1', FileCount: 2, ProtectedFileCount: 1 },
        { FileCount: 1, ProtectedFileCount: 1 },
        { RunId: 'r2', FileCount: 1, ProtectedFileCount: 1 },
      ]),
    ).toBe(1);
  });
});
