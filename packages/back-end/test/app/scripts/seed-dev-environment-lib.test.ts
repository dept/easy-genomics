import {
  DEFAULT_SEED_ORGS,
  buildOrganizationAccessForRole,
  buildSeedUsersFromConfig,
  findLaboratoryByName,
  findOrganizationByName,
  resolveLabBucketName,
  userHasDesiredMembership,
} from '../../../scripts/lib/seed-dev-environment-lib';

describe('seed-dev-environment-lib', () => {
  describe('DEFAULT_SEED_ORGS', () => {
    it('defines Default Organization and Getting Started Org with Test Laboratory', () => {
      expect(DEFAULT_SEED_ORGS).toEqual([
        { organizationName: 'Default Organization', laboratoryName: 'Test Laboratory' },
        { organizationName: 'Getting Started Org', laboratoryName: 'Test Laboratory' },
      ]);
    });
  });

  describe('resolveLabBucketName', () => {
    it('builds the shared non-prod lab bucket name', () => {
      expect(resolveLabBucketName('851725267090', 'dev-inistal')).toBe('851725267090-dev-inistal-lab-bucket');
    });

    it('rejects names longer than 63 characters', () => {
      expect(() => resolveLabBucketName('123456789012', 'dev-' + 'x'.repeat(50))).toThrow(/too long/);
    });
  });

  describe('findOrganizationByName / findLaboratoryByName', () => {
    it('matches case-insensitively', () => {
      expect(findOrganizationByName([{ Name: 'Default Organization' }], 'default organization')?.Name).toBe(
        'Default Organization',
      );
      expect(findLaboratoryByName([{ Name: 'Test Laboratory' }], 'TEST LABORATORY')?.Name).toBe('Test Laboratory');
    });

    it('returns undefined when missing', () => {
      expect(findOrganizationByName([], 'Default Organization')).toBeUndefined();
    });
  });

  describe('buildSeedUsersFromConfig', () => {
    it('maps yaml emails to roles and skips missing emails', () => {
      expect(
        buildSeedUsersFromConfig({
          'org-admin-email': 'admin@easygenomics.org',
          'lab-technician-email': 'lab.technician@easygenomics.org',
        }),
      ).toEqual([
        {
          email: 'admin@easygenomics.org',
          firstName: 'Org',
          lastName: 'Admin',
          role: 'OrganizationAdmin',
        },
        {
          email: 'lab.technician@easygenomics.org',
          firstName: 'Lab',
          lastName: 'Technician',
          role: 'LabTechnician',
        },
      ]);
    });
  });

  describe('buildOrganizationAccessForRole', () => {
    const orgLabs = [
      { organizationId: 'org-1', laboratoryId: 'lab-1' },
      { organizationId: 'org-2', laboratoryId: 'lab-2' },
    ];

    it('gives org-admin access to both orgs without laboratory access', () => {
      expect(buildOrganizationAccessForRole('OrganizationAdmin', orgLabs)).toEqual({
        'org-1': { Status: 'Active', OrganizationAdmin: true, LaboratoryAccess: {} },
        'org-2': { Status: 'Active', OrganizationAdmin: true, LaboratoryAccess: {} },
      });
    });

    it('gives lab-manager LabManager on each lab', () => {
      const access = buildOrganizationAccessForRole('LabManager', orgLabs);
      expect(access['org-1'].LaboratoryAccess['lab-1']).toEqual({
        Status: 'Active',
        LabManager: true,
        LabTechnician: false,
      });
      expect(access['org-2'].OrganizationAdmin).toBe(false);
    });

    it('gives lab-technician LabTechnician on each lab', () => {
      const access = buildOrganizationAccessForRole('LabTechnician', orgLabs);
      expect(access['org-2'].LaboratoryAccess['lab-2']).toEqual({
        Status: 'Active',
        LabManager: false,
        LabTechnician: true,
      });
    });
  });

  describe('userHasDesiredMembership', () => {
    it('detects missing org access', () => {
      expect(userHasDesiredMembership('OrganizationAdmin', 'org-1', 'lab-1', undefined)).toBe(false);
    });

    it('requires OrganizationAdmin flag for org-admin role', () => {
      expect(
        userHasDesiredMembership('OrganizationAdmin', 'org-1', 'lab-1', {
          'org-1': { OrganizationAdmin: false, LaboratoryAccess: {} },
        }),
      ).toBe(false);
      expect(
        userHasDesiredMembership('OrganizationAdmin', 'org-1', 'lab-1', {
          'org-1': { OrganizationAdmin: true, LaboratoryAccess: {} },
        }),
      ).toBe(true);
    });

    it('requires laboratory access for lab roles', () => {
      expect(
        userHasDesiredMembership('LabManager', 'org-1', 'lab-1', {
          'org-1': { OrganizationAdmin: false, LaboratoryAccess: {} },
        }),
      ).toBe(false);
      expect(
        userHasDesiredMembership('LabManager', 'org-1', 'lab-1', {
          'org-1': {
            OrganizationAdmin: false,
            LaboratoryAccess: { 'lab-1': { Status: 'Active' } },
          },
        }),
      ).toBe(true);
    });
  });
});
