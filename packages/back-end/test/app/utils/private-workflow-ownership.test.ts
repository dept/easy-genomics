import {
  canDeleteOwnedPrivateWorkflow,
  creatorIdsFromAuthorizerClaims,
} from '../../../src/app/utils/private-workflow-ownership-utils';

describe('private-workflow-ownership-utils', () => {
  const laboratoryId = 'lab-1';
  const organizationId = 'org-1';
  const creatorIds = new Set(['user-1', 'user-sub']);

  const ownedTags = {
    Application: 'easy-genomics',
    LaboratoryId: laboratoryId,
    OrganizationId: organizationId,
    UserId: 'user-1',
  };

  it('collects sub, cognito username, and custom UserId claims', () => {
    expect(
      creatorIdsFromAuthorizerClaims({
        'sub': 'sub-1',
        'cognito:username': 'username-1',
        'UserId': 'internal-1',
      }),
    ).toEqual(new Set(['sub-1', 'username-1', 'internal-1']));
  });

  it('ignores blank claim values', () => {
    expect(creatorIdsFromAuthorizerClaims({ sub: 'sub-1', UserId: '  ' })).toEqual(new Set(['sub-1']));
  });

  it('allows a workflow created in-app by the caller in the current lab', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: ownedTags,
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(true);
  });

  it('denies when UserId does not match the caller', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...ownedTags, UserId: 'someone-else' },
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(false);
  });

  it('denies when the laboratory tag does not match', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...ownedTags, LaboratoryId: 'other-lab' },
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(false);
  });

  it('denies when the organization tag does not match', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: { ...ownedTags, OrganizationId: 'other-org' },
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(false);
  });

  it('denies console-created workflows with no tags', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: undefined,
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(false);
  });

  it('denies tags that omit UserId', () => {
    expect(
      canDeleteOwnedPrivateWorkflow({
        tags: {
          Application: 'easy-genomics',
          LaboratoryId: laboratoryId,
          OrganizationId: organizationId,
        },
        laboratoryId,
        organizationId,
        creatorIds,
      }),
    ).toBe(false);
  });
});
