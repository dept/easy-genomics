import type { OrganizationStorageLab } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';

export type OrgStorageSortColumn = 'Name' | 'Stored' | 'NotLinked';

export type OrgStorageSort = { column: string; direction: 'asc' | 'desc' };

function compareNames(a: OrganizationStorageLab, b: OrganizationStorageLab): number {
  return a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' });
}

// A lab that has never been scanned has no Storage yet; it holds nothing we know of, so it sorts as zero.
function bytesFor(lab: OrganizationStorageLab, column: OrgStorageSortColumn): number {
  if (column === 'Stored') return lab.Storage?.TotalBytes ?? 0;
  return lab.Storage?.NoRunRecordBytes ?? 0;
}

export function sortOrgStorageLabs(labs: OrganizationStorageLab[], sort: OrgStorageSort): OrganizationStorageLab[] {
  const rows = [...labs];
  const directionFactor = sort.direction === 'asc' ? 1 : -1;

  if (sort.column === 'Name') {
    return rows.sort((a, b) => compareNames(a, b) * directionFactor);
  }

  if (sort.column === 'Stored' || sort.column === 'NotLinked') {
    const column = sort.column;
    return rows.sort((a, b) => {
      const bytesComparison = (bytesFor(a, column) - bytesFor(b, column)) * directionFactor;
      return bytesComparison !== 0 ? bytesComparison : compareNames(a, b);
    });
  }

  return rows;
}

// UTable's built-in sort cycle falls back to the initial column on a third click, so the
// org storage headers toggle their own sort: same column reverses, a new column starts at
// its most useful end (names A to Z, sizes largest first).
export function nextOrgStorageSort(current: OrgStorageSort, column: OrgStorageSortColumn): OrgStorageSort {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column, direction: column === 'Name' ? 'asc' : 'desc' };
}

// /admin is system-admin only; org admins open the lab they already have access to.
export function orgStorageLabLocation(
  orgId: string,
  labId: string,
  superuser: boolean,
): { path: string; query: { tab: 'storage' } } {
  const path = superuser ? `/admin/orgs/${orgId}/labs/${labId}` : `/labs/${labId}`;
  return { path, query: { tab: 'storage' } };
}
