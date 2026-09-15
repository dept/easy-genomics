import { DynamoDBService } from '../../../src/app/services/dynamodb-service';

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
