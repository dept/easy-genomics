process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRunService } from '../../../../src/app/services/easy-genomics/laboratory-run-service';

describe('LaboratoryRunService.markTerminalNotified', () => {
  it('publishes (returns published: true) on the first terminal write', async () => {
    const svc = new LaboratoryRunService();
    const updateItem = jest.spyOn(svc as unknown as { updateItem: jest.Mock }, 'updateItem').mockResolvedValue({
      $metadata: { httpStatusCode: 200 },
      Attributes: marshall({ LaboratoryId: 'lab-1', RunId: 'run-1', NotifiedAt: '2026-07-24T00:00:00.000Z' }),
    });

    const result = await svc.markTerminalNotified({
      LaboratoryId: 'lab-1',
      RunId: 'run-1',
      ModifiedAt: '2026-07-24T00:00:00.000Z',
      ModifiedBy: 'Status Check',
    });

    expect(result.published).toBe(true);
    expect(result.run.NotifiedAt).toBe('2026-07-24T00:00:00.000Z');
    expect(updateItem.mock.calls[0][0]).toMatchObject({
      ConditionExpression: 'attribute_not_exists(#NotifiedAt)',
      UpdateExpression: expect.stringContaining('REMOVE #PollStatus'),
    });
    updateItem.mockRestore();
  });

  it('does not publish a second time (returns published: false) when NotifiedAt already exists', async () => {
    const svc = new LaboratoryRunService();
    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';
    const updateItem = jest
      .spyOn(svc as unknown as { updateItem: jest.Mock }, 'updateItem')
      .mockRejectedValue(conditionalError);
    const get = jest
      .spyOn(svc, 'get')
      .mockResolvedValue({ LaboratoryId: 'lab-1', RunId: 'run-1', NotifiedAt: '2026-07-24T00:00:00.000Z' } as any);

    const result = await svc.markTerminalNotified({
      LaboratoryId: 'lab-1',
      RunId: 'run-1',
      ModifiedAt: '2026-07-24T00:01:00.000Z',
      ModifiedBy: 'Status Check',
    });

    expect(result.published).toBe(false);
    updateItem.mockRestore();
    get.mockRestore();
  });
});

describe('LaboratoryRunService.queryActiveForPolling', () => {
  it('queries the PollStatus_Index and returns every active run across pages', async () => {
    const svc = new LaboratoryRunService();
    const queryItems = jest.spyOn(svc as unknown as { queryItems: jest.Mock }, 'queryItems');
    queryItems
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall({ LaboratoryId: 'lab-1', RunId: 'run-1', PollStatus: 'ACTIVE' })],
        LastEvaluatedKey: { LaboratoryId: { S: 'lab-1' }, RunId: { S: 'run-1' } },
      })
      .mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall({ LaboratoryId: 'lab-2', RunId: 'run-2', PollStatus: 'ACTIVE' })],
      });

    const results = await svc.queryActiveForPolling();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.RunId)).toEqual(['run-1', 'run-2']);
    expect(queryItems.mock.calls[0][0]).toMatchObject({ IndexName: 'PollStatus_Index' });
    queryItems.mockRestore();
  });
});
