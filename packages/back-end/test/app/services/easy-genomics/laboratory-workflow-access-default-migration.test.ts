const mockListByLaboratoryId = jest.fn();
const mockUpsert = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../../../src/app/services/easy-genomics/laboratory-workflow-access-service', () => ({
  LaboratoryWorkflowAccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListByLaboratoryId,
    upsert: mockUpsert,
    remove: mockRemove,
  })),
}));

jest.mock('../../../../src/app/services/easy-genomics/unified-workflow-catalog-service', () => ({
  buildUnifiedWorkflowCatalogForOrganization: jest.fn(),
}));

import { migrateWorkflowAccessOnDefaultModeChange } from '../../../../src/app/services/easy-genomics/laboratory-workflow-access-default-migration';
import { buildUnifiedWorkflowCatalogForOrganization } from '../../../../src/app/services/easy-genomics/unified-workflow-catalog-service';

const buildCatalog = buildUnifiedWorkflowCatalogForOrganization as jest.MockedFunction<
  typeof buildUnifiedWorkflowCatalogForOrganization
>;

describe('migrateWorkflowAccessOnDefaultModeChange', () => {
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const laboratoryId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    jest.clearAllMocks();
    buildCatalog.mockResolvedValue([
      { platform: 'HealthOmics' as const, workflowId: 'omics-a', name: 'Omics A' },
      { platform: 'Seqera' as const, workflowId: 'pipe-b', name: 'Pipe B' },
    ]);
  });

  it('no-ops when mode unchanged', async () => {
    await migrateWorkflowAccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: false,
      nextDefaultOn: false,
    });
    expect(mockListByLaboratoryId).not.toHaveBeenCalled();
  });

  it('false → true: DENY catalog workflows without ALLOW; removes prior ALLOW rows', async () => {
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: laboratoryId,
        OrganizationId: organizationId,
        WorkflowKey: 'HEALTH_OMICS#omics-a',
      },
    ]);

    await migrateWorkflowAccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: false,
      nextDefaultOn: true,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        LaboratoryId: laboratoryId,
        WorkflowKey: 'SEQERA#pipe-b',
        Effect: 'DENY',
        OrganizationId: organizationId,
        WorkflowName: 'Pipe B',
      }),
    );
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'HEALTH_OMICS', 'omics-a');
  });

  it('true → false: ALLOW catalog workflows without DENY; removes prior DENY rows', async () => {
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: laboratoryId,
        OrganizationId: organizationId,
        WorkflowKey: 'SEQERA#pipe-b',
        Effect: 'DENY',
      },
    ]);

    await migrateWorkflowAccessOnDefaultModeChange({
      organizationId,
      laboratoryId,
      previousDefaultOn: true,
      nextDefaultOn: false,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        LaboratoryId: laboratoryId,
        WorkflowKey: 'HEALTH_OMICS#omics-a',
        Effect: 'ALLOW',
        OrganizationId: organizationId,
        WorkflowName: 'Omics A',
      }),
    );
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'SEQERA', 'pipe-b');
  });
});
