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

  it('false → true: never writes DENY rows; clears stale strict-mode rows so workflows are allowed by default', async () => {
    // A lab that had one ALLOW row plus a stale/spurious DENY row while strict.
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: laboratoryId,
        OrganizationId: organizationId,
        WorkflowKey: 'HEALTH_OMICS#omics-a',
      },
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
      previousDefaultOn: false,
      nextDefaultOn: true,
    });

    // Turning "enable new workflows by default" on must NOT deny the catalog.
    expect(mockUpsert).not.toHaveBeenCalled();
    // Both the redundant ALLOW row and the stale DENY row are removed, leaving a
    // clean "allowed unless explicitly denied" state.
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'HEALTH_OMICS', 'omics-a');
    expect(mockRemove).toHaveBeenCalledWith(laboratoryId, 'SEQERA', 'pipe-b');
    expect(mockRemove).toHaveBeenCalledTimes(2);
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
