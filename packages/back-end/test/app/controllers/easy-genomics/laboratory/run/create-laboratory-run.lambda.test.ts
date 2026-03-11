import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/create-laboratory-run.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/sns-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { SnsService } from '../../../../../../src/app/services/sns-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('create-laboratory-run.lambda', () => {
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSnsService: jest.MockedClass<typeof SnsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/create',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
            'cognito:username': 'user-1',
          },
        },
      },
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'create-laboratory-run',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:create-laboratory-run',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/create-laboratory-run',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  const baseRequest = {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    RunName: 'Test Run',
    Platform: 'Seqera Cloud',
    PlatformApiBaseUrl: 'https://tower.example.com',
    Status: 'RUNNING',
    WorkflowName: 'wf',
    ExternalRunId: 'ext-1',
    InputS3Url: 's3://bucket/input',
    OutputS3Url: 's3://bucket/output',
    SampleSheetS3Url: 's3://bucket/sample.csv',
    Settings: { param: 'value' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockSnsService = SnsService as jest.MockedClass<typeof SnsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC = 'arn:aws:sns:region:acct:lab-run-update';
  });

  it('creates a laboratory run for an existing lab and queues status check when ExternalRunId is present', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockRunService.prototype.add as jest.Mock).mockResolvedValue({
      ...baseRequest,
      OrganizationId: 'org-1',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.LaboratoryId).toBe('lab-1');
    expect(body.RunId).toBe('run-1');
    expect(mockLabService.prototype.queryByLaboratoryId).toHaveBeenCalledWith('lab-1');
    expect(mockRunService.prototype.add).toHaveBeenCalled();
    expect(mockSnsService.prototype.publish).toHaveBeenCalled();
  });

  it('does not queue status check when ExternalRunId is missing', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockRunService.prototype.add as jest.Mock).mockResolvedValue({
      ...baseRequest,
      ExternalRunId: undefined,
      OrganizationId: 'org-1',
      Settings: JSON.stringify({}),
    });

    const body = { ...baseRequest, ExternalRunId: undefined };
    const result = await handler(createEvent(body), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockSnsService.prototype.publish).not.toHaveBeenCalled();
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockRunService.prototype.add).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('denies access when user does not have org or lab role', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockRunService.prototype.add).not.toHaveBeenCalled();
  });
});
