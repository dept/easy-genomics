import type { LaboratoryStorageSummary } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import {
  applyStorageProtectionOptimistic,
  applyStorageRemovalOptimistic,
  countFullyProtectedRuns,
  formatRetentionMonthsLabel,
} from '../../../src/app/utils/lab-storage-display';

function sampleSummary(overrides: Partial<LaboratoryStorageSummary> = {}): LaboratoryStorageSummary {
  return {
    OrganizationId: '11111111-1111-1111-1111-111111111111',
    LaboratoryId: '22222222-2222-2222-2222-222222222222',
    S3Bucket: 'bucket',
    ScannedAt: '2026-01-01T00:00:00.000Z',
    TotalBytes: 0,
    AttachedBytes: 0,
    NoRunRecordBytes: 0,
    NoRunRecordFileCount: 0,
    ProtectedItemCount: 0,
    RunCount: 1,
    Items: [],
    ...overrides,
  };
}

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

describe('applyStorageProtectionOptimistic', () => {
  it('marks selected items fully protected and updates ProtectedItemCount', () => {
    const next = applyStorageProtectionOptimistic(
      sampleSummary({
        Items: [
          {
            ItemId: 'a',
            Type: 'RunOutputs',
            Name: 'run-a',
            Path: 'a',
            Detail: 'wf',
            RunId: 'r1',
            FileCount: 2,
            SizeBytes: 100,
            ProtectedFileCount: 0,
            Status: 'Active',
            Deletable: true,
          },
        ],
      }),
      ['a'],
      true,
    );
    expect(next.Items[0].ProtectedFileCount).toBe(2);
    expect(next.ProtectedItemCount).toBe(1);
  });

  it('clears protection on unprotect', () => {
    const next = applyStorageProtectionOptimistic(
      sampleSummary({
        ProtectedItemCount: 1,
        Items: [
          {
            ItemId: 'a',
            Type: 'RunOutputs',
            Name: 'run-a',
            Path: 'a',
            Detail: 'wf',
            FileCount: 2,
            SizeBytes: 100,
            ProtectedFileCount: 2,
            Status: 'Active',
            Deletable: false,
          },
        ],
      }),
      ['a'],
      false,
    );
    expect(next.Items[0].ProtectedFileCount).toBe(0);
    expect(next.ProtectedItemCount).toBe(0);
  });
});

describe('applyStorageRemovalOptimistic', () => {
  it('removes rows and recomputes size pills', () => {
    const next = applyStorageRemovalOptimistic(
      sampleSummary({
        TotalBytes: 150,
        AttachedBytes: 100,
        NoRunRecordBytes: 50,
        NoRunRecordFileCount: 1,
        Items: [
          {
            ItemId: 'keep',
            Type: 'RunOutputs',
            Name: 'keep',
            Path: 'keep',
            Detail: 'wf',
            FileCount: 1,
            SizeBytes: 100,
            ProtectedFileCount: 0,
            Status: 'Active',
            Deletable: true,
          },
          {
            ItemId: 'drop',
            Type: 'Unattached',
            Name: 'drop',
            Path: 'drop',
            Detail: 'Outside any run folder',
            FileCount: 1,
            SizeBytes: 50,
            ProtectedFileCount: 0,
            Status: 'NoRunRecord',
            Deletable: true,
          },
        ],
      }),
      ['drop'],
    );
    expect(next.Items.map((item) => item.ItemId)).toEqual(['keep']);
    expect(next.TotalBytes).toBe(100);
    expect(next.AttachedBytes).toBe(100);
    expect(next.NoRunRecordBytes).toBe(0);
    expect(next.NoRunRecordFileCount).toBe(0);
  });
});
