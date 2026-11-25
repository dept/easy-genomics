import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/list-laboratory-workflow-run-limits.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  buildLaboratoryWorkflowCostRows,
  WORKFLOW_COST_ROW_RUN_ATTRIBUTES,
} from '../../../../../src/app/services/easy-genomics/laboratory-workflow-cost-rows';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-laboratory-workflow-run-limits.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const workflowRunLimits = { 'SEQERA#42': { WorkflowName: 'bactopia', CostBlockAboveUsd: 600 } };
  const runs = [100, 120, 140, 160, 900].map((cost, index) => ({
    LaboratoryId: LAB_ID,
    RunId: `run-${index}`,
    Platform: 'AWS HealthOmics',
    WorkflowExternalId: '5734690',
    WorkflowName: 'nf-core/rnaseq',
    Status: 'COMPLETED',
    CreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    TerminalAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    RunCostOutcome: { ActualComputeCostUsd: cost, CostSource: 'HEALTHOMICS_TASKS', CostCapturedAt: '' },
  }));
  let existing: Record<string, unknown>;

  const mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
  const mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
  const mockValidateSystemAdmin = validateSystemAdminAccess as jest.Mock;
  const mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.Mock;
  const mockValidateLabManager = validateLaboratoryManagerAccess as jest.Mock;
  const mockValidateLabTechnician = validateLaboratoryTechnicianAccess as jest.Mock;

  const createEvent = (laboratoryId: string | undefined) =>
    ({
      isBase64Encoded: false,
      httpMethod: 'GET',
      headers: {},
      requestContext: { authorizer: { claims: { 'cognito:username': 'admin-user' } } },
      queryStringParameters: laboratoryId ? { laboratoryId } : null,
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const invoke = () => handler(createEvent(LAB_ID), {} as Context, () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    existing = {
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      Name: 'Lab',
      Status: 'Active',
      WorkflowRunLimits: workflowRunLimits,
    };
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockImplementation(async () => existing);
    mockRunService.prototype.listAllRunsForLaboratory = jest.fn().mockResolvedValue(runs);
    mockRunService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue([]);
    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  it('returns the rows for an org admin', async () => {
    const result = await invoke();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(buildLaboratoryWorkflowCostRows(runs as any, workflowRunLimits, new Date()));
    expect(body).toEqual([
      expect.objectContaining({ WorkflowId: '42', WorkflowName: 'bactopia', CountedRunCount: 0 }),
      expect.objectContaining({ WorkflowId: '5734690', TypicalRunCostUsd: 140, CountedRunCount: 5 }),
    ]);
  });

  it('reads every page of runs, with only the attributes the rows need', async () => {
    await invoke();

    expect(mockRunService.prototype.listAllRunsForLaboratory).toHaveBeenCalledWith(
      LAB_ID,
      WORKFLOW_COST_ROW_RUN_ATTRIBUTES,
    );
    expect(mockRunService.prototype.queryByLaboratoryId).not.toHaveBeenCalled();
  });

  it('lets a lab manager and a technician of the lab read', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    mockValidateLabManager.mockReturnValue(true);
    expect((await invoke()).statusCode).toBe(200);

    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);
    expect((await invoke()).statusCode).toBe(200);

    expect(mockValidateLabManager).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
    expect(mockValidateLabTechnician).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
  });

  it('returns 403 for an admin of another organization', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await invoke();

    expect(result.statusCode).toBe(403);
    expect(mockValidateOrgAdmin).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(mockRunService.prototype.listAllRunsForLaboratory).not.toHaveBeenCalled();
  });

  it('returns an error, not an empty list, when the run history read fails', async () => {
    mockRunService.prototype.listAllRunsForLaboratory = jest.fn().mockRejectedValue(new Error('Query failed'));

    const result = await invoke();

    // Untyped errors map to EG-100 in buildErrorResponse; what matters is that no rows are returned.
    expect(result.statusCode).not.toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(false);
    expect(body).toEqual({ Error: 'Query failed', ErrorCode: 'EG-100' });
  });

  it('returns a 400-class error without laboratoryId', async () => {
    const result = await handler(createEvent(undefined), {} as Context, () => {});

    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.statusCode).toBeLessThan(500);
    expect(mockLabService.prototype.queryByLaboratoryId).not.toHaveBeenCalled();
  });
});
