import type { WorkflowListItem } from '@aws-sdk/client-omics';
import { LaboratoryService } from '../../../../src/app/services/easy-genomics/laboratory-service';
import { buildUnifiedWorkflowCatalogForOrganization } from '../../../../src/app/services/easy-genomics/unified-workflow-catalog-service';
import { OmicsService } from '../../../../src/app/services/omics-service';
import { listAllSharedWorkflowSummaries } from '../../../../src/app/utils/omics-shared-workflow-utils';

jest.mock('../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../src/app/services/omics-service');
jest.mock('../../../../src/app/services/ssm-service');
jest.mock('../../../../src/app/utils/omics-shared-workflow-utils', () => ({
  listAllSharedWorkflowSummaries: jest.fn(),
}));
jest.mock('../../../../src/app/utils/rest-api-utils', () => ({
  getNextFlowApiQueryParameters: jest.fn(),
  httpRequest: jest.fn(),
  REST_API_METHOD: { GET: 'GET' },
}));

describe('buildUnifiedWorkflowCatalogForOrganization', () => {
  const ORG_ID = 'org-001';
  const LAB_ID = 'lab-001';

  beforeEach(() => {
    jest.clearAllMocks();

    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByOrganizationId = jest
      .fn()
      .mockResolvedValue([
        {
          OrganizationId: ORG_ID,
          LaboratoryId: LAB_ID,
          AwsHealthOmicsEnabled: true,
          NextFlowTowerEnabled: false,
        },
      ]);

    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest.fn();
  });

  it('tags private and shared entries and de-duplicates colliding ids', async () => {
    const privateItems: WorkflowListItem[] = [
      { id: 'wf-private', name: 'Private Only' },
      { id: 'wf-both', name: 'Also Shared' },
    ];

    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest
      .fn()
      .mockResolvedValue({ items: privateItems, nextToken: undefined });

    (listAllSharedWorkflowSummaries as jest.Mock).mockResolvedValue([
      { id: 'wf-shared', name: 'Shared Only', ownerAccountId: '111122223333' },
      { id: 'wf-both', name: 'Shared Dup', ownerAccountId: '444455556666' },
    ]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    const byId = Object.fromEntries(catalog.map((e) => [e.workflowId, e]));

    expect(byId['wf-private']).toMatchObject({
      platform: 'HealthOmics',
      source: 'PRIVATE',
    });
    expect(byId['wf-private'].ownerAccountId).toBeUndefined();

    expect(byId['wf-shared']).toMatchObject({
      platform: 'HealthOmics',
      source: 'SHARED',
      ownerAccountId: '111122223333',
      name: 'Shared Only',
    });

    // Private wins when the same id appears in both lists (seenKeys de-dup).
    expect(byId['wf-both']).toMatchObject({
      platform: 'HealthOmics',
      source: 'PRIVATE',
      name: 'Also Shared',
    });
    expect(byId['wf-both'].ownerAccountId).toBeUndefined();

    expect(catalog.filter((e) => e.workflowId === 'wf-both')).toHaveLength(1);
  });

  it('skips Omics listing when no lab has AwsHealthOmicsEnabled', async () => {
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByOrganizationId = jest
      .fn()
      .mockResolvedValue([
        {
          OrganizationId: ORG_ID,
          LaboratoryId: LAB_ID,
          AwsHealthOmicsEnabled: false,
          NextFlowTowerEnabled: false,
        },
      ]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    expect(catalog).toEqual([]);
    expect(OmicsService.prototype.listWorkflows).not.toHaveBeenCalled();
    expect(listAllSharedWorkflowSummaries).not.toHaveBeenCalled();
  });

  it('paginates private workflows via nextToken', async () => {
    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'wf-page-1', name: 'Page One' }], nextToken: 'token-2' })
      .mockResolvedValueOnce({ items: [{ id: 'wf-page-2', name: 'Page Two' }], nextToken: undefined });
    (listAllSharedWorkflowSummaries as jest.Mock).mockResolvedValue([]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    expect(OmicsService.prototype.listWorkflows).toHaveBeenCalledTimes(2);
    expect(catalog.map((e) => e.workflowId).sort()).toEqual(['wf-page-1', 'wf-page-2']);
  });

  it('skips private workflows missing id and falls back to id when name is missing', async () => {
    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest.fn().mockResolvedValue({
      items: [{ name: 'No Id' }, { id: 'wf-nameless' }, { id: 'wf-named', name: 'Named' }],
      nextToken: undefined,
    });
    (listAllSharedWorkflowSummaries as jest.Mock).mockResolvedValue([]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    expect(catalog).toHaveLength(2);
    expect(catalog.find((e) => e.workflowId === 'wf-nameless')).toMatchObject({
      name: 'wf-nameless',
      platform: 'HealthOmics',
      source: 'PRIVATE',
    });
    expect(catalog.find((e) => e.workflowId === 'wf-named')?.name).toBe('Named');
  });

  it('includes shared workflows without ownerAccountId', async () => {
    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest
      .fn()
      .mockResolvedValue({ items: [], nextToken: undefined });
    (listAllSharedWorkflowSummaries as jest.Mock).mockResolvedValue([{ id: 'wf-shared-bare', name: 'Bare Shared' }]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    expect(catalog).toEqual([
      expect.objectContaining({
        platform: 'HealthOmics',
        workflowId: 'wf-shared-bare',
        name: 'Bare Shared',
        source: 'SHARED',
      }),
    ]);
    expect(catalog[0].ownerAccountId).toBeUndefined();
  });

  it('sorts HealthOmics entries by name then platform:workflowId', async () => {
    (OmicsService as jest.MockedClass<typeof OmicsService>).prototype.listWorkflows = jest.fn().mockResolvedValue({
      items: [
        { id: 'wf-b', name: 'Bravo' },
        { id: 'wf-a2', name: 'Alpha' },
        { id: 'wf-a1', name: 'Alpha' },
      ],
      nextToken: undefined,
    });
    (listAllSharedWorkflowSummaries as jest.Mock).mockResolvedValue([]);

    const catalog = await buildUnifiedWorkflowCatalogForOrganization(ORG_ID);

    expect(catalog.map((e) => e.workflowId)).toEqual(['wf-a1', 'wf-a2', 'wf-b']);
  });
});
