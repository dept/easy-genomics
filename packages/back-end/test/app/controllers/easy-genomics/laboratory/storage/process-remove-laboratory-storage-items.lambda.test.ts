process.env.NAME_PREFIX = 'unit-test';

const mockRemoveItems = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ removeItems: mockRemoveItems })),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/process-remove-laboratory-storage-items.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

describe('process-remove-laboratory-storage-items.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };

  beforeEach(() => {
    jest.clearAllMocks();
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockRemoveItems.mockResolvedValue({ DeletedObjectCount: 2, SkippedObjectCount: 1, Summary: {} });
  });

  it('deletes the items from the queued message', async () => {
    await handler(
      {
        Records: [
          {
            body: JSON.stringify({
              OrganizationId: ORG_ID,
              LaboratoryId: LAB_ID,
              ItemIds: ['RunOutputs#r1'],
            }),
          },
        ],
      } as any,
      {} as any,
      () => {},
    );

    expect(LaboratoryService.prototype.get).toHaveBeenCalledWith(ORG_ID, LAB_ID);
    expect(mockRemoveItems).toHaveBeenCalledWith(laboratory, ['RunOutputs#r1']);
  });

  it('rethrows so SQS retries when delete fails', async () => {
    mockRemoveItems.mockRejectedValue(new Error('S3 timeout'));

    await expect(
      handler(
        {
          Records: [
            {
              body: JSON.stringify({
                OrganizationId: ORG_ID,
                LaboratoryId: LAB_ID,
                ItemIds: ['RunOutputs#r1'],
              }),
            },
          ],
        } as any,
        {} as any,
        () => {},
      ),
    ).rejects.toThrow(/S3 timeout/);
  });
});
