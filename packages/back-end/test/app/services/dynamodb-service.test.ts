import { marshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBService } from '../../../src/app/services/dynamodb-service';

describe('DynamoDBService.batchGetAll', () => {
  const tableName = 'tbl';

  function harness() {
    const svc = new DynamoDBService();
    const mockBatchGetItem = jest.fn();
    const mockSleep = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { batchGetItem: typeof mockBatchGetItem }).batchGetItem = mockBatchGetItem;
    (svc as unknown as { sleep: typeof mockSleep }).sleep = mockSleep;
    return {
      mockBatchGetItem,
      mockSleep,
      batchGetAll: (keys: Record<string, unknown>[]) =>
        (
          svc as unknown as {
            batchGetAll: (
              table: string,
              keys: Record<string, unknown>[],
              opts?: { consistentRead?: boolean },
            ) => Promise<{ items: unknown[]; unprocessedKeys: unknown[] }>;
          }
        ).batchGetAll(tableName, keys, { consistentRead: true }),
    };
  }

  it('chunks keys at 100 and never exceeds the BatchGetItem limit', async () => {
    const { mockBatchGetItem, batchGetAll } = harness();
    const keys = Array.from({ length: 250 }, (_, i) => marshall({ Id: `k-${i}` }));
    mockBatchGetItem.mockImplementation(async (input: { RequestItems: Record<string, { Keys: unknown[] }> }) => {
      const chunk = input.RequestItems[tableName].Keys;
      expect(chunk.length).toBeLessThanOrEqual(100);
      return { Responses: { [tableName]: chunk } };
    });

    const { items, unprocessedKeys } = await batchGetAll(keys);
    expect(mockBatchGetItem).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(250);
    expect(unprocessedKeys).toHaveLength(0);
  });

  it('retries UnprocessedKeys after a delay and merges both responses', async () => {
    const { mockBatchGetItem, mockSleep, batchGetAll } = harness();
    const keyA = marshall({ Id: 'a' });
    const keyB = marshall({ Id: 'b' });
    mockBatchGetItem
      .mockResolvedValueOnce({
        Responses: { [tableName]: [keyA] },
        UnprocessedKeys: { [tableName]: { Keys: [keyB] } },
      })
      .mockResolvedValueOnce({
        Responses: { [tableName]: [keyB] },
      });

    const { items, unprocessedKeys } = await batchGetAll([keyA, keyB]);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockBatchGetItem).toHaveBeenCalledTimes(2);
    expect(items).toEqual([keyA, keyB]);
    expect(unprocessedKeys).toHaveLength(0);
  });
});

describe('DynamoDBService.getExpressionAttributeValuesDefinition', () => {
  const service = new DynamoDBService();

  it('marshals nested objects as DynamoDB Map AttributeValues', () => {
    const result = service.getExpressionAttributeValuesDefinition({
      StatusProgress: { total: 1, completed: 0 },
    });

    expect(result).toEqual({
      ':statusProgress': {
        M: {
          total: { N: '1' },
          completed: { N: '0' },
        },
      },
    });
  });

  it('marshals boolean, number, and string attributes', () => {
    const result = service.getExpressionAttributeValuesDefinition({
      Active: true,
      Count: 42,
      Name: 'example',
    });

    expect(result).toEqual({
      ':active': { BOOL: true },
      ':count': { N: '42' },
      ':name': { S: 'example' },
    });
  });

  it('marshals plain string and number arrays as Lists, not Sets', () => {
    const result = service.getExpressionAttributeValuesDefinition({
      Tags: ['a', 'b'],
      Scores: [1, 2],
    });

    expect(result).toEqual({
      ':tags': {
        L: [{ S: 'a' }, { S: 'b' }],
      },
      ':scores': {
        L: [{ N: '1' }, { N: '2' }],
      },
    });
  });

  it('marshals Set instances as String/Number Sets', () => {
    const result = service.getExpressionAttributeValuesDefinition({
      Tags: new Set(['a', 'b']),
      Scores: new Set([1, 2]),
    });

    expect(result).toEqual({
      ':tags': { SS: ['a', 'b'] },
      ':scores': { NS: ['1', '2'] },
    });
  });

  it('omits excluded keys', () => {
    const result = service.getExpressionAttributeValuesDefinition(
      {
        Name: 'keep',
        Status: 'skip',
      },
      ['Status'],
    );

    expect(result).toEqual({
      ':name': { S: 'keep' },
    });
  });
});
