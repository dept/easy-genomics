process.env.NAME_PREFIX = 'unit-test';

const mockSetProtection = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ setProtection: mockSetProtection })),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/process-edit-laboratory-storage-protection.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

describe('process-edit-laboratory-storage-protection.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };

  beforeEach(() => {
    jest.clearAllMocks();
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockSetProtection.mockResolvedValue({ Items: [] });
  });

  it('applies protection from the queued message', async () => {
    await handler(
      {
        Records: [
          {
            body: JSON.stringify({
              OrganizationId: ORG_ID,
              LaboratoryId: LAB_ID,
              ItemIds: ['InputData#r1'],
              Protected: true,
              UserId: 'user-1',
            }),
          },
        ],
      } as any,
      {} as any,
      () => {},
    );

    expect(mockSetProtection).toHaveBeenCalledWith(laboratory, ['InputData#r1'], true, 'user-1');
  });

  it('rethrows so SQS retries when protect fails', async () => {
    mockSetProtection.mockRejectedValue(new Error('Dynamo throttle'));

    await expect(
      handler(
        {
          Records: [
            {
              body: JSON.stringify({
                OrganizationId: ORG_ID,
                LaboratoryId: LAB_ID,
                ItemIds: ['InputData#r1'],
                Protected: false,
                UserId: 'user-1',
              }),
            },
          ],
        } as any,
        {} as any,
        () => {},
      ),
    ).rejects.toThrow(/Dynamo throttle/);
  });
});
