const mockListByLaboratoryId = jest.fn();
const mockUpsert = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../../../src/app/services/easy-genomics/laboratory-s3-access-service', () => ({
  LaboratoryS3AccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListByLaboratoryId,
    upsert: mockUpsert,
    remove: mockRemove,
  })),
}));

jest.mock('../../../../src/app/services/easy-genomics/s3-bucket-catalog-service', () => ({
  listDataTaggedS3Buckets: jest.fn(),
}));

import { migrateS3AccessOnDefaultModeChange } from '../../../../src/app/services/easy-genomics/laboratory-s3-access-default-migration';
import { listDataTaggedS3Buckets } from '../../../../src/app/services/easy-genomics/s3-bucket-catalog-service';

const buildCatalog = listDataTaggedS3Buckets as jest.MockedFunction<typeof listDataTaggedS3Buckets>;

describe('migrateS3AccessOnDefaultModeChange', () => {
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const laboratoryId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    jest.clearAllMocks();
    buildCatalog.mockResolvedValue([{ name: 'bucket-a' }, { name: 'bucket-b' }]);
  });

  it('no-ops when mode unchanged', async () => {
    await migrateS3AccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: false,
      nextDefaultOn: false,
    });
    expect(mockListByLaboratoryId).not.toHaveBeenCalled();
  });

  it('false → true: DENY catalog buckets without ALLOW; removes prior ALLOW rows', async () => {
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: laboratoryId,
        OrganizationId: organizationId,
        BucketName: 'bucket-a',
      },
    ]);

    await migrateS3AccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: false,
      nextDefaultOn: true,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        LaboratoryId: laboratoryId,
        BucketName: 'bucket-b',
        Effect: 'DENY',
        OrganizationId: organizationId,
      }),
    );
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'bucket-a');
  });

  it('true → false: ALLOW catalog buckets without DENY; removes prior DENY rows', async () => {
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: laboratoryId,
        OrganizationId: organizationId,
        BucketName: 'bucket-b',
        Effect: 'DENY',
      },
    ]);

    await migrateS3AccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: true,
      nextDefaultOn: false,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        LaboratoryId: laboratoryId,
        BucketName: 'bucket-a',
        Effect: 'ALLOW',
        OrganizationId: organizationId,
      }),
    );
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'bucket-b');
  });
});
