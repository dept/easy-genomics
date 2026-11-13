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
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Attributes: marshall(laboratory) });
    const queryByLaboratoryId = jest.spyOn(svc, 'queryByLaboratoryId');
    return { svc, updateItem, queryByLaboratoryId };
  };

  it('sets only RunLimits and the modified fields on the existing lab', async () => {
    const { svc, updateItem, queryByLaboratoryId } = setup();
    const runLimits = { CostWarnAboveUsd: 150, SamplesBlockAbove: 500 };

    const result = await svc.updateRunLimits(laboratory, runLimits, 'admin-user');

    const input = updateItem.mock.calls[0][0];
    expect(input.Key).toEqual(marshall({ OrganizationId: 'o1', LaboratoryId: 'l1' }));
    expect(input.UpdateExpression).toBe(
      'SET #ModifiedAt = :modifiedAt, #ModifiedBy = :modifiedBy, #RunLimits = :runLimits',
    );
    expect(input.ConditionExpression).toBe('attribute_exists(#OrganizationId) AND attribute_exists(#LaboratoryId)');
    expect(input.ExpressionAttributeValues[':runLimits']).toEqual({ M: marshall(runLimits) });
    expect(input.ExpressionAttributeValues[':modifiedBy']).toEqual({ S: 'admin-user' });
    expect(input.ExpressionAttributeValues[':modifiedAt'].S).toEqual(expect.any(String));
    expect(input.ReturnValues).toBe('ALL_NEW');
    // The LaboratoryId index is eventually consistent, so the written item is returned instead of read back.
    expect(queryByLaboratoryId).not.toHaveBeenCalled();
    expect(result).toEqual(laboratory);
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

describe('LaboratoryService.update', () => {
  const ORG_ID = '7a2c1d4e-0b3f-4c5a-9d6e-1f2a3b4c5d6e';
  const LAB_ID = 'b3e4f5a6-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
  const existing = {
    OrganizationId: ORG_ID,
    LaboratoryId: LAB_ID,
    Name: 'Lab A',
    Status: 'Active',
    AwsHealthOmicsEnabled: true,
    NextFlowTowerEnabled: true,
    RunLimits: { SamplesBlockAbove: 500 },
  } as Laboratory;

  const setup = () => {
    const svc = new LaboratoryService();
    const updateItem = jest
      .spyOn(svc as unknown as { updateItem: jest.Mock }, 'updateItem')
      .mockImplementation(async () => ({ $metadata: { httpStatusCode: 200 }, Attributes: marshall(existing) }));
    const transactWriteItems = jest
      .spyOn(svc as unknown as { transactWriteItems: jest.Mock }, 'transactWriteItems')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    const queryByLaboratoryId = jest.spyOn(svc, 'queryByLaboratoryId').mockResolvedValue(existing);
    return { svc, updateItem, transactWriteItems, queryByLaboratoryId };
  };

  const writtenNames = (input: { ExpressionAttributeNames: Record<string, string> }) =>
    Object.values(input.ExpressionAttributeNames);

  // A full-item put would write back the RunLimits read at the start of the request and undo a concurrent limits save.
  it('updates attributes in place and never writes RunLimits', async () => {
    const { svc, updateItem } = setup();

    await svc.update({ ...existing, Description: 'New description' }, existing);

    const input = updateItem.mock.calls[0][0];
    expect(input.Key).toEqual(marshall({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID }));
    expect(input.ConditionExpression).toBe('attribute_exists(#OrganizationId) AND attribute_exists(#LaboratoryId)');
    expect(writtenNames(input)).toEqual(expect.arrayContaining(['Name', 'Description', 'AwsHealthOmicsEnabled']));
    expect(writtenNames(input)).not.toContain('RunLimits');
    expect(input.UpdateExpression).not.toMatch(/#OrganizationId =|#LaboratoryId =/);
  });

  it('removes attributes the updated lab no longer has, as replacing the item did', async () => {
    const { svc, updateItem } = setup();
    const withoutSeqera: Laboratory = { ...existing };
    delete withoutSeqera.NextFlowTowerEnabled;

    await svc.update(withoutSeqera, existing);

    const input = updateItem.mock.calls[0][0];
    const removed = input.UpdateExpression.split('REMOVE ')[1].split(', ');
    expect(removed.map((placeholder: string) => input.ExpressionAttributeNames[placeholder])).toEqual([
      'NextFlowTowerEnabled',
    ]);
  });

  it('returns the written lab rather than reading it back through the eventually consistent index', async () => {
    const { svc, updateItem, queryByLaboratoryId } = setup();

    const result = await svc.update(existing, existing);

    expect(updateItem.mock.calls[0][0].ReturnValues).toBe('ALL_NEW');
    expect(queryByLaboratoryId).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it('renames through a transaction whose lab write also leaves RunLimits alone', async () => {
    const { svc, transactWriteItems } = setup();

    await svc.update({ ...existing, Name: 'Lab B' }, existing);

    const [labWrite, oldName, newName] = transactWriteItems.mock.calls[0][0].TransactItems;
    expect(labWrite.Update.TableName).toBe('unit-test-laboratory-table');
    expect(Object.values(labWrite.Update.ExpressionAttributeNames)).not.toContain('RunLimits');
    expect(oldName.Delete.Key.Value).toEqual({ S: 'lab a' });
    expect(newName.Put.Item.Value).toEqual({ S: 'lab b' });
  });
});
