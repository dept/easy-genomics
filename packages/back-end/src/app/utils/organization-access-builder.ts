import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  LaboratoryAccessDetails,
  OrganizationAccess,
  OrganizationAccessDetails,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';

/**
 * Builds the OrganizationAccess map used in JWT claims and permission checks from
 * organization-user-table and laboratory-user-table rows (single source of truth).
 */
export function buildOrganizationAccessFromMemberships(
  organizationUsers: OrganizationUser[],
  laboratoryUsers: LaboratoryUser[],
): OrganizationAccess {
  const result: OrganizationAccess = {};

  for (const ou of organizationUsers) {
    result[ou.OrganizationId] = <OrganizationAccessDetails>{
      Status: ou.Status,
      OrganizationAdmin: ou.OrganizationAdmin,
      LaboratoryAccess: {},
    };
  }

  for (const lu of laboratoryUsers) {
    const orgEntry = result[lu.OrganizationId];
    if (!orgEntry) {
      continue;
    }
    if (!orgEntry.LaboratoryAccess) {
      orgEntry.LaboratoryAccess = {};
    }
    orgEntry.LaboratoryAccess[lu.LaboratoryId] = <LaboratoryAccessDetails>{
      Status: lu.Status,
      LabManager: lu.LabManager,
      LabTechnician: lu.LabTechnician,
    };
  }

  return result;
}
