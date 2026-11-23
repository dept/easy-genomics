import { canDeletePrivateOmicsWorkflow } from '../../../src/app/utils/omics-workflow-ownership';

describe('canDeletePrivateOmicsWorkflow', () => {
  const privateWorkflow = {
    id: 'wf-1',
    source: 'PRIVATE' as const,
    tags: { UserId: 'user-1', Application: 'easy-genomics' },
  };

  it('allows an org admin to delete a private workflow they did not create', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: privateWorkflow,
        isOrgAdmin: true,
      }),
    ).toBe(true);
  });

  it('allows when creator tags are missing (API enforces Easy Genomics ownership)', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { id: 'wf-1', source: 'PRIVATE' },
        isOrgAdmin: true,
      }),
    ).toBe(true);
  });

  it('denies when the caller is not an org admin', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: privateWorkflow,
        isOrgAdmin: false,
      }),
    ).toBe(false);
  });

  it('denies shared workflows', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { ...privateWorkflow, source: 'SHARED' },
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it('denies when the workflow id is missing', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { ...privateWorkflow, id: undefined },
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });

  it('denies when tags show the workflow was not created via Easy Genomics', () => {
    expect(
      canDeletePrivateOmicsWorkflow({
        workflow: { id: 'wf-1', source: 'PRIVATE', tags: { Application: 'aws-console' } },
        isOrgAdmin: true,
      }),
    ).toBe(false);
  });
});
