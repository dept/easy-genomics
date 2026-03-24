import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/run/create-run-execution.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/services/omics-lab-factory', () => ({
  createOmicsServiceForLab: jest.fn(),
}));
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('@easy-genomics/shared-lib/lib/app/schema/aws-healthomics/aws-healthomics-api', () => ({
  CreateRunRequestSchema: {
    safeParse: jest.fn((val) => ({ success: !!val && !!val.workflowId && !!val.name && !!val.parameters })),
  },
}));

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '../../../../../src/app/services/omics-lab-factory';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('create-run-execution.lambda', () => {
  const LAB_ID = 'lab-123';
  const ORG_ID = 'org-123';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const baseRequest = {
    workflowId: 'wf-123',
    requestId: 'req-123',
    name: 'Test run',
    parameters: JSON.stringify({
      outdir: 's3://bucket/output',
      param1: 'value1',
    }),
  };

  const createEvent = (
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/aws-healthomics/run/create-run-execution',
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
      queryStringParameters: {
        laboratoryId: LAB_ID,
      },
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'create-run-execution',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:create-run-execution',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/create-run-execution',
      logStreamName: '2026/03/17/[$LATEST]test',
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

    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockOmicsService.prototype.startRun = jest.fn();
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
      startRun: mockOmicsService.prototype.startRun,
    });

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  it('starts a run with expected tags including user info', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    (mockOmicsService.prototype.startRun as jest.Mock).mockResolvedValue({
      id: 'run-123',
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.startRun).toHaveBeenCalledTimes(1);
    const startRunInput = (mockOmicsService.prototype.startRun as jest.Mock).mock.calls[0][0];

    expect(startRunInput.tags).toMatchObject({
      LaboratoryId: LAB_ID,
      OrganizationId: ORG_ID,
      WorkflowId: baseRequest.workflowId,
      RunName: baseRequest.name,
      UserId: 'user-123',
      UserEmail: 'user@example.com',
      Application: 'easy-genomics',
      Platform: 'AWS HealthOmics',
    });
    expect(startRunInput.workflowVersionName).toBeUndefined();
  });

  it('forwards workflowVersionName to StartRun when provided', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    (mockOmicsService.prototype.startRun as jest.Mock).mockResolvedValue({
      id: 'run-123',
    });

    const body = { ...baseRequest, workflowVersionName: 'my-version-1' };
    const result = await handler(createEvent(body), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const startRunInput = (mockOmicsService.prototype.startRun as jest.Mock).mock.calls[0][0];
    expect(startRunInput.workflowVersionName).toBe('my-version-1');
  });

  it('omits user tags when claims are missing', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    (mockOmicsService.prototype.startRun as jest.Mock).mockResolvedValue({
      id: 'run-123',
    });

    const event = createEvent(baseRequest, {
      requestContext: {
        authorizer: {
          claims: {
            OrganizationAccess: JSON.stringify({ [ORG_ID]: { Status: 'Active' } }),
          },
        },
      },
    } as any);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const startRunInput = (mockOmicsService.prototype.startRun as jest.Mock).mock.calls[0][0];

    expect(startRunInput.tags.UserId).toBeUndefined();
    expect(startRunInput.tags.UserEmail).toBeUndefined();
  });

  it('rejects invalid request body', async () => {
    const event = createEvent({}, {});

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.startRun).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(404);
    expect(mockOmicsService.prototype.startRun).not.toHaveBeenCalled();
  });

  it('denies access when user does not have org or lab role', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.startRun).not.toHaveBeenCalled();
  });
});
