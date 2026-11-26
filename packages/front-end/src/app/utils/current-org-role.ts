import { OrganizationAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';

export type CurrentOrgRole = 'System admin' | 'Organization admin' | 'Lab manager' | 'Lab technician';

export function currentOrgRole(
  isSuperuser: boolean,
  orgPermissions: OrganizationAccess | null,
  currentOrgId: string | null | undefined,
): CurrentOrgRole | null {
  if (isSuperuser) return 'System admin';
  if (!currentOrgId) return null;

  const orgAccess = orgPermissions?.[currentOrgId];
  if (orgAccess?.Status !== 'Active') return null;
  if (orgAccess.OrganizationAdmin) return 'Organization admin';

  const activeLabs = Object.values(orgAccess.LaboratoryAccess ?? {}).filter((lab) => lab.Status === 'Active');
  if (activeLabs.some((lab) => lab.LabManager)) return 'Lab manager';
  if (activeLabs.some((lab) => lab.LabTechnician)) return 'Lab technician';
  return null;
}
