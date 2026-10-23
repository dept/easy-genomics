import {
  EditWorkflowKeyOutputDeliverySchema,
  RequestRunMicroreactExportSchema,
  WorkflowKeyOutputMicroreactDeliverySchema,
} from './workflow-key-outputs';

const LAB_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '44444444-4444-4444-8444-444444444444';
const METADATA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TREE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('WorkflowKeyOutputMicroreactDeliverySchema', () => {
  it('accepts an enabled export with a metadata key output and trees', () => {
    const result = WorkflowKeyOutputMicroreactDeliverySchema.safeParse({
      Enabled: true,
      MetadataKeyOutputId: METADATA_ID,
      TreeKeyOutputIds: [TREE_ID],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a disabled export with no roles', () => {
    expect(WorkflowKeyOutputMicroreactDeliverySchema.safeParse({ Enabled: false }).success).toBe(true);
  });

  it('rejects an enabled export without a metadata key output', () => {
    const result = WorkflowKeyOutputMicroreactDeliverySchema.safeParse({ Enabled: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['MetadataKeyOutputId']);
  });

  it('rejects a tree that is also the metadata key output', () => {
    const result = WorkflowKeyOutputMicroreactDeliverySchema.safeParse({
      Enabled: true,
      MetadataKeyOutputId: METADATA_ID,
      TreeKeyOutputIds: [METADATA_ID],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate tree key outputs', () => {
    const result = WorkflowKeyOutputMicroreactDeliverySchema.safeParse({
      Enabled: true,
      MetadataKeyOutputId: METADATA_ID,
      TreeKeyOutputIds: [TREE_ID, TREE_ID],
    });
    expect(result.success).toBe(false);
  });
});

describe('EditWorkflowKeyOutputDeliverySchema', () => {
  it('accepts a Microreact-only delivery with S3 copy off', () => {
    const result = EditWorkflowKeyOutputDeliverySchema.safeParse({
      LaboratoryId: LAB_ID,
      WorkflowId: 'wf-1',
      Enabled: false,
      Microreact: { Enabled: true, MetadataKeyOutputId: METADATA_ID },
    });
    expect(result.success).toBe(true);
  });
});

describe('RequestRunMicroreactExportSchema', () => {
  it('requires the organization, laboratory and run', () => {
    expect(
      RequestRunMicroreactExportSchema.safeParse({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, RunId: 'run-1' })
        .success,
    ).toBe(true);
    expect(RequestRunMicroreactExportSchema.safeParse({ LaboratoryId: LAB_ID, RunId: 'run-1' }).success).toBe(false);
  });
});
