import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/update-laboratory-workflow-run-limits.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../src/app/utils/auth-utils';

describe('update-laboratory-workflow-run-limits.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000009';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const WORKFLOW_KEY = 'HEALTH_OMICS#5734690';
  const base = { Platform: 'HEALTH_OMICS', WorkflowId: '5734690', WorkflowName: 'nf-core/rnaseq' };
  const labRunLimits = { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400 };
  let existing: Record<string, unknown>;

  const mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
  const mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.Mock;
  const mockValidateSystemAdmin = validateSystemAdminAccess as jest.Mock;

  const createEvent = (id: string | undefined, body: string | undefined) =>
    ({
      body,
      isBase64Encoded: false,
      httpMethod: 'PUT',
      headers: {},
      requestContext: { authorizer: { claims: { 'cognito:username': 'admin-user' } } },
      pathParameters: id ? { id } : null,
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const invoke = (body: string | undefined, id: string | null = LAB_ID) =>
    handler(createEvent(id ?? undefined, body), {} as Context, () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    existing = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, Name: 'Lab', Status: 'Active', RunLimits: labRunLimits };
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockImplementation(async () => existing);
    mockLabService.prototype.updateWorkflowRunLimits = jest.fn().mockImplementation(async () => existing);
    mockLabService.prototype.updateRunLimits = jest.fn();
    mockLabService.prototype.update = jest.fn();
    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateSystemAdmin.mockReturnValue(false);
  });

  it("saves a workflow amount above the lab's for an org admin", async () => {
    const result = await invoke(JSON.stringify({ ...base, CostWarnAboveUsd: 300, CostBlockAboveUsd: 800 }));

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.updateWorkflowRunLimits).toHaveBeenCalledWith(
      existing,
      WORKFLOW_KEY,
      { WorkflowName: 'nf-core/rnaseq', CostWarnAboveUsd: 300, CostBlockAboveUsd: 800 },
      'admin-user',
    );
    expect(mockLabService.prototype.updateRunLimits).not.toHaveBeenCalled();
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('saves one amount without writing the other', async () => {
    const result = await invoke(JSON.stringify({ ...base, CostBlockAboveUsd: 800 }));

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.updateWorkflowRunLimits).toHaveBeenCalledWith(
      existing,
      WORKFLOW_KEY,
      { WorkflowName: 'nf-core/rnaseq', CostBlockAboveUsd: 800 },
      'admin-user',
    );
  });

  it('saves the limits for a system admin', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(true);

    const result = await invoke(JSON.stringify({ ...base, CostBlockAboveUsd: 800 }));

    expect(result.statusCode).toBe(200);
  });

  it("rejects a warn amount that would sit above the lab's block amount", async () => {
    existing.RunLimits = { CostBlockAboveUsd: 400 };

    const result = await invoke(JSON.stringify({ ...base, CostWarnAboveUsd: 500 }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toBe(
      "Invalid request: For nf-core/rnaseq, block above (US$400, the lab's) must be higher than warn above (US$500, the workflow's) for estimated cost per run.",
    );
    expect(mockLabService.prototype.updateWorkflowRunLimits).not.toHaveBeenCalled();
  });

  it("removes the workflow's entry when both amounts are omitted", async () => {
    const result = await invoke(JSON.stringify(base));

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.updateWorkflowRunLimits).toHaveBeenCalledWith(
      existing,
      WORKFLOW_KEY,
      undefined,
      'admin-user',
    );
  });

  it('returns 403 for a lab manager or technician', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await invoke(JSON.stringify({ ...base, CostBlockAboveUsd: 800 }));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-103');
    expect(mockLabService.prototype.updateWorkflowRunLimits).not.toHaveBeenCalled();
  });

  it('returns 403 for an org admin of another organization', async () => {
    mockValidateOrgAdmin.mockImplementation((_event, organizationId) => organizationId === OTHER_ORG_ID);

    const result = await invoke(JSON.stringify({ ...base, CostBlockAboveUsd: 800 }));

    expect(mockValidateOrgAdmin).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(result.statusCode).toBe(403);
    expect(mockLabService.prototype.updateWorkflowRunLimits).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['a null body', 'null'],
    ['a string amount', JSON.stringify({ ...base, CostWarnAboveUsd: '300' })],
    ['an unknown key', JSON.stringify({ ...base, SamplesBlockAbove: 10 })],
    ['a workflow id with a #', JSON.stringify({ ...base, WorkflowId: 'a#b' })],
  ])('returns 400 for %s and writes nothing', async (_label, body) => {
    const result = await invoke(body);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-102');
    expect(mockLabService.prototype.updateWorkflowRunLimits).not.toHaveBeenCalled();
  });

  it('returns 400 when the path id is missing', async () => {
    const result = await invoke(JSON.stringify(base), null);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toBe('Required id is missing');
  });
});
