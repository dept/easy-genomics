import { canDeletePrivateOmicsWorkflow } from '../../../src/app/utils/omics-workflow-ownership';

describe('canDeletePrivateOmicsWorkflow', () => {
  const ownedWorkflow = {
    id: 'wf-1',
    source: 'PRIVATE' as const,
    tags: { UserId: 'user-1' },
  };

  it('allows a private workflow created by the current user', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: ownedWorkflow,
        canCreateOmicsWorkflows: true,
        userIds: ['user-1', 'internal-1'],
      }),
    ).toBe(true);
  });

  it('matches either current user id', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: ownedWorkflow,
        canCreateOmicsWorkflows: true,
        userIds: ['other', 'user-1'],
      }),
    ).toBe(true);
  });

  it('denies when the caller cannot create workflows', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: ownedWorkflow,
        canCreateOmicsWorkflows: false,
        userIds: ['user-1'],
      }),
    ).toBe(false);
  });

  it('denies shared workflows', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { ...ownedWorkflow, source: 'SHARED' },
        canCreateOmicsWorkflows: true,
        userIds: ['user-1'],
      }),
    ).toBe(false);
  });

  it('denies when the workflow id is missing', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { ...ownedWorkflow, id: undefined },
        canCreateOmicsWorkflows: true,
        userIds: ['user-1'],
      }),
    ).toBe(false);
  });

  it('fails closed when tags are missing (console-created or unenriched list item)', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { id: 'wf-1', source: 'PRIVATE' },
        canCreateOmicsWorkflows: true,
        userIds: ['user-1'],
      }),
    ).toBe(false);
  });

  it('fails closed when UserId is missing from tags', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { id: 'wf-1', source: 'PRIVATE', tags: { LaboratoryId: 'lab-1' } },
        canCreateOmicsWorkflows: true,
        userIds: ['user-1'],
      }),
    ).toBe(false);
  });

  it('denies when UserId belongs to another user', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: ownedWorkflow,
        canCreateOmicsWorkflows: true,
        userIds: ['someone-else'],
      }),
    ).toBe(false);
  });
});
