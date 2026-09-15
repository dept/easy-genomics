process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../../../../src/app/services/easy-genomics/laboratory-run-service';

describe('LaboratoryRunService.queryByWorkflowExternalId', () => {
  it('paginates until exhausted and respects limit', async () => {
    const svc = new LaboratoryRunService();
    const run1 = { RunId: 'r1', WorkflowExternalId: 'wf-1', TerminalAt: '2026-06-01T00:00:00Z' } as LaboratoryRun;
    const run2 = { RunId: 'r2', WorkflowExternalId: 'wf-1', TerminalAt: '2026-05-01T00:00:00Z' } as LaboratoryRun;
    const run3 = { RunId: 'r3', WorkflowExternalId: 'wf-1', TerminalAt: '2026-04-01T00:00:00Z' } as LaboratoryRun;

    const queryItems = jest.spyOn(svc as unknown as { queryItems: jest.Mock }, 'queryItems');
    queryItems
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(run1), marshall(run2)],
        LastEvaluatedKey: { WorkflowExternalId: { S: 'wf-1' }, TerminalAt: { S: '2026-05-01T00:00:00Z' } },
      })
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(run3)],
      });

    const rows = await svc.queryByWorkflowExternalId('wf-1', {
      sinceTerminalAt: '2026-01-01T00:00:00Z',
      limit: 2,
    });

    expect(queryItems).toHaveBeenCalledTimes(1);
    expect(queryItems.mock.calls[0][0]).toMatchObject({
      IndexName: 'WorkflowExternalId_Index',
      Limit: 2,
    });
    expect(rows.map((r) => r.RunId)).toEqual(['r1', 'r2']);

    queryItems.mockRestore();
  });

  it('continues pagination when under limit', async () => {
    const svc = new LaboratoryRunService();
    const run1 = { RunId: 'r1', WorkflowExternalId: 'wf-1' } as LaboratoryRun;
    const run2 = { RunId: 'r2', WorkflowExternalId: 'wf-1' } as LaboratoryRun;

    const queryItems = jest.spyOn(svc as unknown as { queryItems: jest.Mock }, 'queryItems');
    queryItems
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(run1)],
        LastEvaluatedKey: { WorkflowExternalId: { S: 'wf-1' } },
      })
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(run2)],
      });

    const rows = await svc.queryByWorkflowExternalId('wf-1', { limit: 10 });
    expect(queryItems).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => r.RunId)).toEqual(['r1', 'r2']);
    queryItems.mockRestore();
  });
});
