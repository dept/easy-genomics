import { FavouriteWorkflowSchema, UserSchema, UpdateUserSchema } from '../../../../src/app/schema/easy-genomics/user';

describe('FavouriteWorkflowSchema', () => {
  const validWorkflow = {
    WorkflowId: 'wf-123',
    WorkflowName: 'rnaseq',
    Description: 'RNA sequencing pipeline',
    Platform: 'AWS HealthOmics' as const,
    LaboratoryId: 'lab-456',
  };

  it('accepts a valid favourite workflow', () => {
    const result = FavouriteWorkflowSchema.safeParse(validWorkflow);
    expect(result.success).toBe(true);
  });

  it('accepts a favourite workflow without Description', () => {
    const { Description: _, ...withoutDesc } = validWorkflow;
    const result = FavouriteWorkflowSchema.safeParse(withoutDesc);
    expect(result.success).toBe(true);
  });

  it('accepts Seqera Cloud as Platform', () => {
    const result = FavouriteWorkflowSchema.safeParse({
      ...validWorkflow,
      Platform: 'Seqera Cloud',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid Platform value', () => {
    const result = FavouriteWorkflowSchema.safeParse({
      ...validWorkflow,
      Platform: 'Invalid Platform',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when WorkflowId is missing', () => {
    const { WorkflowId: _, ...withoutId } = validWorkflow;
    const result = FavouriteWorkflowSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects when WorkflowName is missing', () => {
    const { WorkflowName: _, ...withoutName } = validWorkflow;
    const result = FavouriteWorkflowSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it('rejects when LaboratoryId is missing', () => {
    const { LaboratoryId: _, ...withoutLab } = validWorkflow;
    const result = FavouriteWorkflowSchema.safeParse(withoutLab);
    expect(result.success).toBe(false);
  });

  it('rejects when Platform is missing', () => {
    const { Platform: _, ...withoutPlatform } = validWorkflow;
    const result = FavouriteWorkflowSchema.safeParse(withoutPlatform);
    expect(result.success).toBe(false);
  });
});

describe('UserSchema — FavouriteWorkflows field', () => {
  const baseUser = {
    UserId: '550e8400-e29b-41d4-a716-446655440000',
    Email: 'test@example.com',
    Status: 'Active' as const,
  };

  it('accepts a user without FavouriteWorkflows', () => {
    const result = UserSchema.safeParse(baseUser);
    expect(result.success).toBe(true);
  });

  it('accepts a user with an empty FavouriteWorkflows array', () => {
    const result = UserSchema.safeParse({ ...baseUser, FavouriteWorkflows: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a user with valid FavouriteWorkflows', () => {
    const result = UserSchema.safeParse({
      ...baseUser,
      FavouriteWorkflows: [
        {
          WorkflowId: 'wf-1',
          WorkflowName: 'pipeline-a',
          Platform: 'Seqera Cloud',
          LaboratoryId: 'lab-1',
        },
        {
          WorkflowId: 'wf-2',
          WorkflowName: 'pipeline-b',
          Description: 'A genomics workflow',
          Platform: 'AWS HealthOmics',
          LaboratoryId: 'lab-2',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a user with an invalid FavouriteWorkflows entry', () => {
    const result = UserSchema.safeParse({
      ...baseUser,
      FavouriteWorkflows: [{ WorkflowId: 'wf-1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects FavouriteWorkflows as a non-array value', () => {
    const result = UserSchema.safeParse({
      ...baseUser,
      FavouriteWorkflows: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateUserSchema — FavouriteWorkflows field', () => {
  it('accepts an update with only FavouriteWorkflows', () => {
    const result = UpdateUserSchema.safeParse({
      FavouriteWorkflows: [
        {
          WorkflowId: 'wf-1',
          WorkflowName: 'pipeline-a',
          Platform: 'Seqera Cloud',
          LaboratoryId: 'lab-1',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an update with FavouriteWorkflows alongside other fields', () => {
    const result = UpdateUserSchema.safeParse({
      FirstName: 'Jane',
      LastName: 'Doe',
      FavouriteWorkflows: [
        {
          WorkflowId: 'wf-2',
          WorkflowName: 'rnaseq',
          Description: 'RNA-seq pipeline',
          Platform: 'AWS HealthOmics',
          LaboratoryId: 'lab-2',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an update with an empty FavouriteWorkflows array', () => {
    const result = UpdateUserSchema.safeParse({ FavouriteWorkflows: [] });
    expect(result.success).toBe(true);
  });

  it('accepts an update without FavouriteWorkflows', () => {
    const result = UpdateUserSchema.safeParse({ FirstName: 'Jane' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields due to strict mode', () => {
    const result = UpdateUserSchema.safeParse({
      FavouriteWorkflows: [],
      UnknownField: 'value',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an update with an invalid workflow entry in FavouriteWorkflows', () => {
    const result = UpdateUserSchema.safeParse({
      FavouriteWorkflows: [{ WorkflowId: 'wf-1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an update where FavouriteWorkflows has an invalid Platform', () => {
    const result = UpdateUserSchema.safeParse({
      FavouriteWorkflows: [
        {
          WorkflowId: 'wf-1',
          WorkflowName: 'pipeline',
          Platform: 'Unknown',
          LaboratoryId: 'lab-1',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
