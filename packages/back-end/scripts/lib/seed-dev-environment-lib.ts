/**
 * Pure helpers for the personal / shared-dev environment seed script.
 * Keeps seed shape and membership logic unit-testable without AWS.
 */

export type SeedUserRole = 'OrganizationAdmin' | 'LabManager' | 'LabTechnician';

export type SeedOrgSpec = {
  organizationName: string;
  laboratoryName: string;
};

export type SeedUserSpec = {
  email: string;
  firstName: string;
  lastName: string;
  role: SeedUserRole;
};

/** Canonical org/lab pairs seeded into empty personal-dev environments. */
export const DEFAULT_SEED_ORGS: SeedOrgSpec[] = [
  { organizationName: 'Default Organization', laboratoryName: 'Test Laboratory' },
  { organizationName: 'Getting Started Org', laboratoryName: 'Test Laboratory' },
];

export function resolveLabBucketName(awsAccountId: string, namePrefix: string): string {
  const bucket = `${awsAccountId}-${namePrefix}-lab-bucket`;
  if (bucket.length > 63) {
    throw new Error(`Derived S3 bucket name is too long (>63): ${bucket}`);
  }
  return bucket;
}

export function findOrganizationByName<T extends { Name: string }>(organizations: T[], name: string): T | undefined {
  const needle = name.toLowerCase();
  return organizations.find((org) => org.Name.toLowerCase() === needle);
}

export function findLaboratoryByName<T extends { Name: string }>(laboratories: T[], name: string): T | undefined {
  const needle = name.toLowerCase();
  return laboratories.find((lab) => lab.Name.toLowerCase() === needle);
}

export function buildSeedUsersFromConfig(backEnd: {
  'org-admin-email'?: string;
  'lab-manager-email'?: string;
  'lab-technician-email'?: string;
}): SeedUserSpec[] {
  const users: SeedUserSpec[] = [];

  if (backEnd['org-admin-email']) {
    users.push({
      email: backEnd['org-admin-email'],
      firstName: 'Org',
      lastName: 'Admin',
      role: 'OrganizationAdmin',
    });
  }
  if (backEnd['lab-manager-email']) {
    users.push({
      email: backEnd['lab-manager-email'],
      firstName: 'Lab',
      lastName: 'Manager',
      role: 'LabManager',
    });
  }
  if (backEnd['lab-technician-email']) {
    users.push({
      email: backEnd['lab-technician-email'],
      firstName: 'Lab',
      lastName: 'Technician',
      role: 'LabTechnician',
    });
  }

  return users;
}

export type OrgLabIds = {
  organizationId: string;
  laboratoryId: string;
};

/**
 * Build the embedded User.OrganizationAccess blob for a seeded role across all orgs/labs.
 * Mirrors packages/shared-lib sample-data role shapes.
 */
export function buildOrganizationAccessForRole(
  role: SeedUserRole,
  orgLabs: OrgLabIds[],
): Record<
  string,
  {
    Status: 'Active';
    OrganizationAdmin: boolean;
    LaboratoryAccess: Record<string, { Status: 'Active'; LabManager: boolean; LabTechnician: boolean }>;
  }
> {
  const access: Record<
    string,
    {
      Status: 'Active';
      OrganizationAdmin: boolean;
      LaboratoryAccess: Record<string, { Status: 'Active'; LabManager: boolean; LabTechnician: boolean }>;
    }
  > = {};

  for (const { organizationId, laboratoryId } of orgLabs) {
    if (role === 'OrganizationAdmin') {
      access[organizationId] = {
        Status: 'Active',
        OrganizationAdmin: true,
        LaboratoryAccess: {},
      };
      continue;
    }

    access[organizationId] = {
      Status: 'Active',
      OrganizationAdmin: false,
      LaboratoryAccess: {
        [laboratoryId]: {
          Status: 'Active',
          LabManager: role === 'LabManager',
          LabTechnician: role === 'LabTechnician',
        },
      },
    };
  }

  return access;
}

/** True when a user’s OrganizationAccess already grants the desired org/lab membership. */
export function userHasDesiredMembership(
  role: SeedUserRole,
  organizationId: string,
  laboratoryId: string,
  organizationAccess:
    | Record<string, { OrganizationAdmin?: boolean; LaboratoryAccess?: Record<string, unknown> }>
    | undefined,
): boolean {
  const orgAccess = organizationAccess?.[organizationId];
  if (!orgAccess) {
    return false;
  }

  if (role === 'OrganizationAdmin') {
    return orgAccess.OrganizationAdmin === true;
  }

  const labAccess = orgAccess.LaboratoryAccess?.[laboratoryId];
  return !!labAccess;
}
