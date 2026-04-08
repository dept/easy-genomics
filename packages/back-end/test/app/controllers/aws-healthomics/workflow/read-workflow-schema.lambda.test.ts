const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/services/secrets-manager-service');
jest.mock('../../../../../src/app/services/aws-healthomics/workflow-schema-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/read-workflow-schema.lambda';
import { WorkflowSchemaService } from '../../../../../src/app/services/aws-healthomics/workflow-schema-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import { SecretsManagerService } from '../../../../../src/app/services/secrets-manager-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('read-workflow-schema.lambda', () => {
  const WORKFLOW_ID = '1234567';
  const LAB_ID = 'lab-001';
  const ORG_ID = 'org-001';
  const SECRET_NAME = 'github-pat-secret';
  const GITHUB_PAT = 'ghp_test_pat_token';
  const GITHUB_REPO_URL = 'https://github.com/nf-core/rnaseq';

  const savedSchema = {
    WorkflowId: WORKFLOW_ID,
    Version: '1',
    Schema: {
      $schema: 'http://json-schema.org/draft-07/schema',
      title: 'nf-core/rnaseq',
      definitions: {},
    },
    UpdatedAt: '2026-01-01T00:00:00.000Z',
  };

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockSecretsManagerService: jest.MockedClass<typeof SecretsManagerService>;
  let mockWorkflowSchemaService: jest.MockedClass<typeof WorkflowSchemaService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    workflowId: string | undefined,
    laboratoryId: string | undefined,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: `/aws-healthomics/workflow/read-workflow-schema/${workflowId ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-123',
            email: 'user@example.com',
            OrganizationAccess: JSON.stringify({ [ORG_ID]: { Status: 'Active' } }),
          },
        },
      },
      resource: '',
      queryStringParameters: laboratoryId ? { laboratoryId } : null,
      multiValueQueryStringParameters: null,
      pathParameters: workflowId ? { id: workflowId } : null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'read-workflow-schema',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:read-workflow-schema',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/read-workflow-schema',
      logStreamName: '2026/03/31/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_PAT_SECRET_NAME = SECRET_NAME;

    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockSecretsManagerService = SecretsManagerService as jest.MockedClass<typeof SecretsManagerService>;
    mockWorkflowSchemaService = WorkflowSchemaService as jest.MockedClass<typeof WorkflowSchemaService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    mockWorkflowSchemaService.prototype.getSchema = jest.fn().mockResolvedValue(savedSchema);
    mockOmicsService.prototype.getWorkflow = jest.fn();
    mockSecretsManagerService.prototype.getSecretValue = jest.fn();

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.GITHUB_PAT_SECRET_NAME;
  });

  it('returns cached schema from DynamoDB when available', async () => {
    const wfId = 'wf-dynamo-hit';
    const schema = { ...savedSchema, WorkflowId: wfId };
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(schema);

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.WorkflowId).toBe(wfId);
    expect(body.Schema).toEqual(savedSchema.Schema);
    expect(mockWorkflowSchemaService.prototype.getSchema).toHaveBeenCalledWith(wfId, '1');
  });

  it('falls back to GitHub when DynamoDB has no schema', async () => {
    const wfId = 'wf-github-fallback';
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(null);

    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: wfId,
      tags: { 'github-repo-url': GITHUB_REPO_URL },
    });
    (mockSecretsManagerService.prototype.getSecretValue as jest.Mock).mockResolvedValue({
      SecretString: GITHUB_PAT,
    });

    const schemaContent = { $schema: 'http://json-schema.org/draft-07/schema', title: 'fallback' };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: Buffer.from(JSON.stringify(schemaContent)).toString('base64'),
        encoding: 'base64',
      }),
    } as Response);

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Schema).toEqual(schemaContent);
    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalled();
  });

  it('returns 204 when no schema is available from DynamoDB or GitHub', async () => {
    const wfId = 'wf-no-schema';
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(null);
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: wfId,
      tags: {},
    });

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when workflow id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockWorkflowSchemaService.prototype.getSchema).not.toHaveBeenCalled();
  });

  it('returns 400 when laboratoryId query parameter is missing', async () => {
    const result = await handler(createEvent('wf-missing-lab', undefined), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockWorkflowSchemaService.prototype.getSchema).not.toHaveBeenCalled();
  });

  it('returns 400 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent('wf-lab-not-found', LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 403 when user has no lab or org access', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent('wf-no-access', LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockWorkflowSchemaService.prototype.getSchema).not.toHaveBeenCalled();
  });

  it('allows access for laboratory manager', async () => {
    const wfId = 'wf-lab-manager';
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(savedSchema);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(true);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(200);
  });

  it('allows access for laboratory technician', async () => {
    const wfId = 'wf-lab-tech';
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(savedSchema);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(200);
  });

  it('validates auth with correct organization and lab IDs', async () => {
    const wfId = 'wf-auth-check';
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(savedSchema);

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);

    await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(mockValidateOrgAdmin).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(mockValidateLabManager).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
    expect(mockValidateLabTechnician).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
  });

  it('returns 204 when GITHUB_PAT_SECRET_NAME is not set and DynamoDB has no schema', async () => {
    const wfId = 'wf-no-secret';
    delete process.env.GITHUB_PAT_SECRET_NAME;
    (mockWorkflowSchemaService.prototype.getSchema as jest.Mock).mockResolvedValue(null);
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: wfId,
      tags: { 'github-repo-url': GITHUB_REPO_URL },
    });

    const result = await handler(createEvent(wfId, LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(204);
  });
});
