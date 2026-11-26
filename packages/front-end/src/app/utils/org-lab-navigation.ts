import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import type { OrganizationAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';

export type OrgPickerRow = {
  orgId: string;
  name: string;
  detail: string;
  isPreviewed: boolean;
  isCurrent: boolean;
};

export type LabPickerRow = {
  labId: string;
  name: string;
  description: string;
  isCurrent: boolean;
  actionLabel: 'Open' | 'Select lab';
  showSettings: boolean;
};

export type LabRowsState = 'loading' | 'failed' | 'empty' | 'ready';

function labCountText(count: number): string {
  return count === 1 ? '1 lab' : `${count} labs`;
}

export function buildOrgPickerRows(
  orgs: Organization[],
  opts: {
    currentOrgId: string | null;
    previewOrgId: string;
    labCountByOrg: Record<string, number | undefined>;
    isOrgAdmin: (orgId: string) => boolean;
  },
): OrgPickerRow[] {
  return [...orgs]
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map((org) => {
      const labCount = opts.labCountByOrg[org.OrganizationId];
      const isCurrent = org.OrganizationId === opts.currentOrgId;
      const detailParts = [
        labCount === undefined ? '' : labCountText(labCount),
        opts.isOrgAdmin(org.OrganizationId) ? 'Org admin' : '',
        isCurrent ? 'Current' : '',
      ];

      return {
        orgId: org.OrganizationId,
        name: org.Name,
        detail: detailParts.filter(Boolean).join(' · '),
        isPreviewed: org.OrganizationId === opts.previewOrgId,
        isCurrent,
      };
    });
}

export function buildLabPickerRows(
  labs: Laboratory[],
  opts: { orgId: string; currentOrgId: string | null; currentLabId: string | null; canOpenSettings: boolean },
): LabPickerRow[] {
  const isWorkingOrg = opts.orgId === opts.currentOrgId;

  return [...labs]
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map((lab) => {
      const isCurrent = isWorkingOrg && lab.LaboratoryId === opts.currentLabId;
      return {
        labId: lab.LaboratoryId,
        name: lab.Name,
        description: lab.Description ?? '',
        isCurrent,
        actionLabel: isCurrent ? 'Open' : 'Select lab',
        showSettings: opts.canOpenSettings,
      };
    });
}

export function labRowsState(opts: { isLoading: boolean; hasFailed: boolean; labCount: number }): LabRowsState {
  if (opts.isLoading) return 'loading';
  if (opts.hasFailed) return 'failed';
  return opts.labCount === 0 ? 'empty' : 'ready';
}

/**
 * The orgs whose labs you can list: listing labs needs an active membership or org admin rights,
 * while the token's org list also carries inactive and invited memberships.
 */
export function orgsYouCanOpen(orgs: Organization[], orgPermissions: OrganizationAccess | null): Organization[] {
  return orgs.filter((org) => {
    const access = orgPermissions?.[org.OrganizationId];
    return access?.Status === 'Active' || access?.OrganizationAdmin === true;
  });
}

export function contextChipText(opts: { orgName: string | null; labName: string | null; inOrgSettings: boolean }): {
  orgLine: string | null;
  mainLine: string;
} {
  if (opts.inOrgSettings) {
    return { orgLine: opts.orgName, mainLine: 'Organization settings' };
  }
  if (opts.labName) {
    return { orgLine: opts.orgName, mainLine: opts.labName };
  }
  return { orgLine: null, mainLine: opts.orgName ?? '' };
}
