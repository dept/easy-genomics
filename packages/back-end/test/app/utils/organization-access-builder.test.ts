import { buildOrganizationAccessFromMemberships } from '../../../src/app/utils/organization-access-builder';

describe('buildOrganizationAccessFromMemberships', () => {
  it('merges organization users and laboratory users by organizationId', () => {
    const result = buildOrganizationAccessFromMemberships(
      [
        {
          OrganizationId: 'org-1',
          UserId: 'user-1',
          Status: 'Active',
          OrganizationAdmin: true,
        },
      ],
      [
        {
          LaboratoryId: 'lab-1',
          UserId: 'user-1',
          OrganizationId: 'org-1',
          Status: 'Active',
          LabManager: true,
          LabTechnician: false,
        },
      ],
    );

    expect(result).toEqual({
      'org-1': {
        Status: 'Active',
        OrganizationAdmin: true,
        LaboratoryAccess: {
          'lab-1': {
            Status: 'Active',
            LabManager: true,
            LabTechnician: false,
          },
        },
      },
    });
  });

  it('ignores laboratory rows when no matching organization membership exists', () => {
    const result = buildOrganizationAccessFromMemberships(
      [],
      [
        {
          LaboratoryId: 'lab-1',
          UserId: 'user-1',
          OrganizationId: 'org-1',
          Status: 'Active',
          LabManager: false,
          LabTechnician: true,
        },
      ],
    );

    expect(result).toEqual({});
  });
});
