import type { OrganizationStorageLab } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import {
  nextOrgStorageSort,
  orgStorageLabLocation,
  sortOrgStorageLabs,
} from '../../../src/app/utils/org-storage-table';

function lab(name: string, totalBytes?: number, noRunRecordBytes?: number): OrganizationStorageLab {
  const base = { LaboratoryId: `lab-${name.toLowerCase()}`, Name: name };
  if (totalBytes === undefined) return base;
  return {
    ...base,
    Storage: { TotalBytes: totalBytes, NoRunRecordBytes: noRunRecordBytes ?? 0 },
  } as OrganizationStorageLab;
}

const labs: OrganizationStorageLab[] = [lab('Enterics', 286e9, 1.9e9), lab('influenza', 141e9, 0), lab('Training')];

function names(rows: OrganizationStorageLab[]): string[] {
  return rows.map((row) => row.Name);
}

describe('sortOrgStorageLabs', () => {
  it('sorts by name case-insensitively', () => {
    expect(names(sortOrgStorageLabs(labs, { column: 'Name', direction: 'asc' }))).toEqual([
      'Enterics',
      'influenza',
      'Training',
    ]);
    expect(names(sortOrgStorageLabs(labs, { column: 'Name', direction: 'desc' }))).toEqual([
      'Training',
      'influenza',
      'Enterics',
    ]);
  });

  it('sorts by stored bytes, treating labs with no storage data as zero', () => {
    expect(names(sortOrgStorageLabs(labs, { column: 'Stored', direction: 'desc' }))).toEqual([
      'Enterics',
      'influenza',
      'Training',
    ]);
    expect(names(sortOrgStorageLabs(labs, { column: 'Stored', direction: 'asc' }))).toEqual([
      'Training',
      'influenza',
      'Enterics',
    ]);
  });

  it('sorts by bytes not linked to a run, breaking ties by name A to Z', () => {
    expect(names(sortOrgStorageLabs(labs, { column: 'NotLinked', direction: 'desc' }))).toEqual([
      'Enterics',
      'influenza',
      'Training',
    ]);
    expect(names(sortOrgStorageLabs(labs, { column: 'NotLinked', direction: 'asc' }))).toEqual([
      'influenza',
      'Training',
      'Enterics',
    ]);
  });

  it('keeps input order for an unsortable column and does not mutate the input', () => {
    const input = [...labs];
    expect(sortOrgStorageLabs(input, { column: 'Runs', direction: 'asc' })).toEqual(labs);
    expect(input).toEqual(labs);
  });
});

describe('nextOrgStorageSort', () => {
  it('reverses the direction when the sorted column is clicked again, however many times', () => {
    let sort = nextOrgStorageSort({ column: 'Stored', direction: 'desc' }, 'Name');
    expect(sort).toEqual({ column: 'Name', direction: 'asc' });
    sort = nextOrgStorageSort(sort, 'Name');
    expect(sort).toEqual({ column: 'Name', direction: 'desc' });
    sort = nextOrgStorageSort(sort, 'Name');
    expect(sort).toEqual({ column: 'Name', direction: 'asc' });
  });

  it('starts size columns largest first', () => {
    expect(nextOrgStorageSort({ column: 'Name', direction: 'asc' }, 'Stored')).toEqual({
      column: 'Stored',
      direction: 'desc',
    });
    expect(nextOrgStorageSort({ column: 'Stored', direction: 'desc' }, 'NotLinked')).toEqual({
      column: 'NotLinked',
      direction: 'desc',
    });
  });
});

describe('orgStorageLabLocation', () => {
  it('sends organization admins to the lab they belong to', () => {
    expect(orgStorageLabLocation('org-1', 'lab-1', false)).toEqual({ path: '/labs/lab-1', query: { tab: 'storage' } });
  });

  it('sends system admins through the admin route', () => {
    expect(orgStorageLabLocation('org-1', 'lab-1', true)).toEqual({
      path: '/admin/orgs/org-1/labs/lab-1',
      query: { tab: 'storage' },
    });
  });
});
