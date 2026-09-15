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
