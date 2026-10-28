process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { WorkflowKeyOutputs } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { WorkflowKeyOutputsService } from '../../../../src/app/services/easy-genomics/workflow-key-outputs-service';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const WORKFLOW_ID = 'wf-viralrecon';

function definitionFixture(overrides?: Partial<WorkflowKeyOutputs>): WorkflowKeyOutputs {
  return {
    LaboratoryId: LAB_ID,
    WorkflowId: WORKFLOW_ID,
    WorkflowName: 'nf-core/viralrecon',
    Platform: 'AWS HealthOmics',
    SourceRunId: 'run-1',
    KeyOutputs: [
      {
        KeyOutputId: '3f7c1c9e-1111-4111-8111-111111111111',
        Label: 'Consensus genome',
        Pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa',
      },
    ],
    CreatedAt: '2026-01-01T00:00:00.000Z',
    CreatedBy: 'user-1',
    ModifiedAt: '2026-01-01T00:00:00.000Z',
    ModifiedBy: 'user-1',
    ...overrides,
  };
}

describe('WorkflowKeyOutputsService', () => {
  let svc: WorkflowKeyOutputsService;
  let mockPutItem: jest.Mock;
  let mockGetItem: jest.Mock;
  let mockDeleteItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new WorkflowKeyOutputsService();
    mockPutItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    mockGetItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    mockDeleteItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
  });

  it('targets the name-prefixed table', () => {
    expect(svc.WORKFLOW_KEY_OUTPUTS_TABLE_NAME).toEqual('unit-test-workflow-key-outputs-table');
  });

  it('returns undefined when the lab has not declared key outputs for the workflow', async () => {
    mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    await expect(svc.get(LAB_ID, WORKFLOW_ID)).resolves.toBeUndefined();
  });

  it('creates a definition when none exists yet', async () => {
    mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    const saved = await svc.save(definitionFixture());

    expect(saved.WorkflowId).toEqual(WORKFLOW_ID);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem.mock.calls[0][0].ConditionExpression).toContain('attribute_not_exists');
  });

  it('replaces an existing definition and keeps original CreatedAt/CreatedBy', async () => {
    const existing = definitionFixture({ CreatedBy: 'original-user' });
    mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });

    const saved = await svc.save(
      definitionFixture({
        CreatedAt: '2026-09-01T00:00:00.000Z',
        CreatedBy: 'new-user',
        ModifiedBy: 'new-user',
        KeyOutputs: [],
      }),
    );

    expect(saved.CreatedBy).toEqual('original-user');
    expect(saved.CreatedAt).toEqual('2026-01-01T00:00:00.000Z');
    expect(saved.KeyOutputs).toEqual([]);
    expect(mockPutItem.mock.calls[0][0].ConditionExpression).toContain('attribute_exists');
  });
});
