process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryService } from '../../../../src/app/services/easy-genomics/laboratory-service';

describe('LaboratoryService.listAllLaboratories', () => {
  it('follows LastEvaluatedKey until the scan is complete', async () => {
    const svc = new LaboratoryService();
    const lab1 = { LaboratoryId: 'l1', OrganizationId: 'o1', Name: 'Lab A' } as Laboratory;
    const lab2 = { LaboratoryId: 'l2', OrganizationId: 'o2', Name: 'Lab B' } as Laboratory;

    const findAll = jest.spyOn(svc as unknown as { findAll: jest.Mock }, 'findAll');
    findAll
      .mockResolvedValueOnce({
        Items: [marshall(lab1)],
        LastEvaluatedKey: { OrganizationId: { S: 'o1' }, LaboratoryId: { S: 'l1' } },
      })
      .mockResolvedValueOnce({
        Items: [marshall(lab2)],
      });

    const rows = await svc.listAllLaboratories();

    expect(findAll).toHaveBeenCalledTimes(2);
    expect(findAll.mock.calls[1][0]).toMatchObject({
      ExclusiveStartKey: { OrganizationId: { S: 'o1' }, LaboratoryId: { S: 'l1' } },
    });
    expect(rows.map((r) => r.LaboratoryId)).toEqual(['l1', 'l2']);

    findAll.mockRestore();
  });
});

describe('LaboratoryService.updateRunLimits', () => {
  const laboratory = { OrganizationId: 'o1', LaboratoryId: 'l1', Name: 'Lab A' } as Laboratory;

  const setup = () => {
    const svc = new LaboratoryService();
    const updateItem = jest
      .spyOn(svc as unknown as { updateItem: jest.Mock }, 'updateItem')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    const queryByLaboratoryId = jest.spyOn(svc, 'queryByLaboratoryId').mockResolvedValue(laboratory);
    return { svc, updateItem, queryByLaboratoryId };
  };

  it('sets only RunLimits and the modified fields on the existing lab', async () => {
    const { svc, updateItem, queryByLaboratoryId } = setup();
    const runLimits = { CostWarnAboveUsd: 150, SamplesBlockAbove: 500 };

    const result = await svc.updateRunLimits(laboratory, runLimits, 'admin-user');

    const input = updateItem.mock.calls[0][0];
    expect(input.Key).toEqual(marshall({ OrganizationId: 'o1', LaboratoryId: 'l1' }));
    expect(input.UpdateExpression).toBe('SET #ModifiedAt = :modifiedAt, #ModifiedBy = :modifiedBy, #RunLimits = :runLimits');
    expect(input.ConditionExpression).toBe('attribute_exists(#OrganizationId) AND attribute_exists(#LaboratoryId)');
    expect(input.ExpressionAttributeValues[':runLimits']).toEqual({ M: marshall(runLimits) });
    expect(input.ExpressionAttributeValues[':modifiedBy']).toEqual({ S: 'admin-user' });
    expect(input.ExpressionAttributeValues[':modifiedAt'].S).toEqual(expect.any(String));
    expect(queryByLaboratoryId).toHaveBeenCalledWith('l1');
    expect(result).toBe(laboratory);
  });

  it('removes RunLimits when every limit is cleared', async () => {
    const { svc, updateItem } = setup();

    await svc.updateRunLimits(laboratory, {}, 'admin-user');

    const input = updateItem.mock.calls[0][0];
    expect(input.UpdateExpression).toBe('REMOVE #RunLimits SET #ModifiedAt = :modifiedAt, #ModifiedBy = :modifiedBy');
    expect(input.ExpressionAttributeValues[':runLimits']).toBeUndefined();
    expect(input.ExpressionAttributeValues[':modifiedBy']).toEqual({ S: 'admin-user' });
  });

  it('does not write undefined limit fields', async () => {
    const { svc, updateItem } = setup();

    await svc.updateRunLimits(laboratory, { CostWarnAboveUsd: 150, CostBlockAboveUsd: undefined }, 'admin-user');

    expect(updateItem.mock.calls[0][0].ExpressionAttributeValues[':runLimits']).toEqual({
      M: { CostWarnAboveUsd: { N: '150' } },
    });
  });
});
