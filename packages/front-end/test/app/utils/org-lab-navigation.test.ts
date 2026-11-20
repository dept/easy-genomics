import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import type { OrganizationAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import {
  buildLabPickerRows,
  buildOrgPickerRows,
  contextChipText,
  labRowsState,
  orgsYouCanOpen,
} from '../../../src/app/utils/org-lab-navigation';

function org(OrganizationId: string, Name: string): Organization {
  return { OrganizationId, Name } as Organization;
}

function lab(LaboratoryId: string, Name: string, Description?: string): Laboratory {
  return { LaboratoryId, Name, Description } as Laboratory;
}

describe('buildOrgPickerRows', () => {
  const wsl = org('o2', 'Wisconsin State Laboratory');
  const demo = org('o1', 'Demonstration Organization');

  it('sorts by name and describes lab count, admin role and current org', () => {
    const rows = buildOrgPickerRows([wsl, demo], {
      currentOrgId: 'o2',
      previewOrgId: 'o1',
      labCountByOrg: { o1: 1, o2: 3 },
      isOrgAdmin: (orgId) => orgId === 'o2',
    });

    expect(rows.map((row) => row.name)).toEqual(['Demonstration Organization', 'Wisconsin State Laboratory']);
    expect(rows[0]).toMatchObject({
      orgId: 'o1',
      detail: '1 lab',
      isPreviewed: true,
      isCurrent: false,
      canManage: false,
    });
    expect(rows[1]).toMatchObject({
      orgId: 'o2',
      detail: '3 labs · Org admin · Current',
      isPreviewed: false,
      isCurrent: true,
      canManage: true,
    });
  });

  it('leaves the lab count out while it is unknown', () => {
    const [row] = buildOrgPickerRows([wsl], {
      currentOrgId: 'o2',
      previewOrgId: 'o2',
      labCountByOrg: {},
      isOrgAdmin: () => false,
    });

    expect(row.detail).toBe('Current');
  });

  it('returns a single previewed row for a user in one organization', () => {
    const rows = buildOrgPickerRows([wsl], {
      currentOrgId: 'o2',
      previewOrgId: 'o2',
      labCountByOrg: { o2: 0 },
      isOrgAdmin: () => false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ detail: '0 labs · Current', isPreviewed: true });
  });
});

describe('buildLabPickerRows', () => {
  it('marks the lab you are in as Open and the others as Select lab, sorted by name', () => {
    const rows = buildLabPickerRows([lab('l2', 'EHD'), lab('l1', 'CDD', 'Development space')], {
      orgId: 'o1',
      currentOrgId: 'o1',
      currentLabId: 'l2',
      canOpenSettings: true,
    });

    expect(rows.map((row) => [row.name, row.actionLabel, row.isCurrent])).toEqual([
      ['CDD', 'Select lab', false],
      ['EHD', 'Open', true],
    ]);
    expect(rows[0].description).toBe('Development space');
    expect(rows[1].description).toBe('');
    expect(rows.every((row) => row.showSettings)).toBe(true);
  });

  it('never marks a lab as current in a previewed organization', () => {
    const rows = buildLabPickerRows([lab('l2', 'EHD')], {
      orgId: 'o2',
      currentOrgId: 'o1',
      currentLabId: 'l2',
      canOpenSettings: false,
    });

    expect(rows[0]).toMatchObject({ actionLabel: 'Select lab', isCurrent: false, showSettings: false });
  });
});

describe('labRowsState', () => {
  it.each([
    [{ isLoading: true, hasFailed: false, labCount: 0 }, 'loading'],
    [{ isLoading: false, hasFailed: true, labCount: 0 }, 'failed'],
    [{ isLoading: false, hasFailed: true, labCount: 2 }, 'failed'],
    [{ isLoading: false, hasFailed: false, labCount: 0 }, 'empty'],
    [{ isLoading: false, hasFailed: false, labCount: 2 }, 'ready'],
  ] as const)('%o is %s', (input, expected) => {
    expect(labRowsState(input)).toBe(expected);
  });
});

describe('contextChipText', () => {
  it('shows the org above the lab', () => {
    expect(contextChipText({ orgName: 'WSL', labName: 'CDD', inOrgSettings: false })).toEqual({
      orgLine: 'WSL',
      mainLine: 'CDD',
    });
  });

  it('shows Organization settings inside org settings', () => {
    expect(contextChipText({ orgName: 'WSL', labName: 'CDD', inOrgSettings: true })).toEqual({
      orgLine: 'WSL',
      mainLine: 'Organization settings',
    });
  });

  it('shows just the org when no lab is known', () => {
    expect(contextChipText({ orgName: 'WSL', labName: null, inOrgSettings: false })).toEqual({
      orgLine: null,
      mainLine: 'WSL',
    });
  });
});

describe('orgsYouCanOpen', () => {
  const orgs = [org('active', 'Active'), org('inactive', 'Inactive'), org('invited', 'Invited'), org('admin', 'Admin')];

  it('keeps orgs where your membership is active or you are an org admin', () => {
    const kept = orgsYouCanOpen(orgs, {
      active: { Status: 'Active', OrganizationAdmin: false, LaboratoryAccess: {} },
      inactive: { Status: 'Inactive', OrganizationAdmin: false, LaboratoryAccess: {} },
      invited: { Status: 'Invited', OrganizationAdmin: false, LaboratoryAccess: {} },
      admin: { Status: 'Invited', OrganizationAdmin: true, LaboratoryAccess: {} },
    } as unknown as OrganizationAccess);

    expect(kept.map((o) => o.OrganizationId)).toEqual(['active', 'admin']);
  });

  it('keeps nothing when permissions are not loaded', () => {
    expect(orgsYouCanOpen(orgs, null)).toEqual([]);
  });
});
