import { canDeleteOwnedPrivateWorkflow } from '../../../src/app/utils/private-workflow-ownership-utils';

describe('private-workflow-ownership-utils', () => {
  const laboratoryId = 'lab-1';
  const organizationId = 'org-1';

  const labTags = {
    Application: 'easy-genomics',
    LaboratoryId: laboratoryId,
    OrganizationId: organizationId,
    UserId: 'user-1',
  };

  it('allows an Easy Genomics private workflow tagged to the laboratory', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: labTags,
        laboratoryId,
        organizationId,
      }),
    ).toBe(true);
  });

  it('allows when UserId belongs to another user (org admin may delete any lab workflow)', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...labTags, UserId: 'someone-else' },
        laboratoryId,
        organizationId,
      }),
    ).toBe(true);
  });

  it('allows when UserId is omitted', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: {
          Application: 'easy-genomics',
          LaboratoryId: laboratoryId,
          OrganizationId: organizationId,
        },
        laboratoryId,
        organizationId,
      }),
    ).toBe(true);
  });

  it('denies when the laboratory tag does not match', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...labTags, LaboratoryId: 'other-lab' },
        laboratoryId,
        organizationId,
      }),
    ).toBe(false);
  });

  it('denies when the organization tag does not match', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...labTags, OrganizationId: 'other-org' },
        laboratoryId,
        organizationId,
      }),
    ).toBe(false);
  });

  it('denies console-created workflows with no tags', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: undefined,
        laboratoryId,
        organizationId,
      }),
    ).toBe(false);
  });

  it('denies when Application is not easy-genomics', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...labTags, Application: 'aws-console' },
        laboratoryId,
        organizationId,
      }),
    ).toBe(false);
  });
});
