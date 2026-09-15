import { migrateItem, migrateSk, needsMigration } from '../../scripts/lib/migrate-samples-and-sequence-collections-lib';

describe('migrate-samples-and-sequence-collections helpers', () => {
  it('migrates tag-map Gsi1Sk from SEQSET# to SAMPLE#', () => {
    expect(migrateSk('SEQSET#set-1')).toBe('SAMPLE#set-1');
  });

  it('applies longer prefixes before shorter overlapping ones', () => {
    expect(migrateSk('SEQSETFILE#ref')).toBe('SAMPLEFILE#ref');
    expect(migrateSk('MAP#TAG#tag-1#SEQSET#set-1')).toBe('MAP#TAG#tag-1#SAMPLE#set-1');
  });

  it('migrates Sk, Gsi1Pk, Gsi1Sk, and attribute renames', () => {
    const migrated = migrateItem({
      LaboratoryId: 'lab-1',
      Sk: 'MAP#TAG#tag-1#SEQSET#set-1',
      Gsi1Pk: 'lab-1#TAG#tag-1',
      Gsi1Sk: 'SEQSET#set-1',
      SequenceSetId: 'set-1',
    });

    expect(migrated).toEqual({
      LaboratoryId: 'lab-1',
      Sk: 'MAP#TAG#tag-1#SAMPLE#set-1',
      Gsi1Pk: 'lab-1#TAG#tag-1',
      Gsi1Sk: 'SAMPLE#set-1',
      SampleId: 'set-1',
    });
  });

  it('detects rows needing migration from Gsi1Sk alone', () => {
    expect(
      needsMigration({
        LaboratoryId: 'lab-1',
        Sk: 'MAP#TAG#tag-1#SAMPLE#set-1',
        Gsi1Sk: 'SEQSET#set-1',
        SampleId: 'set-1',
      }),
    ).toBe(true);
  });

  it('is idempotent for already-migrated rows', () => {
    const item = {
      LaboratoryId: 'lab-1',
      Sk: 'SAMPLE#set-1',
      Gsi1Sk: 'SAMPLE#set-1',
      SampleId: 'set-1',
    };
    expect(needsMigration(item)).toBe(false);
    expect(migrateItem(item)).toEqual(item);
  });
});
