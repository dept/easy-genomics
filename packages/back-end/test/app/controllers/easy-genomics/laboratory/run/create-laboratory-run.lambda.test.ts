import { LaboratoryRunAlreadyExistsError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockEstimate = jest.fn();
const mockToPreRunCostEstimate = jest.fn();
const mockBuildRunInputProfile = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service');
jest.mock('../../../../../../src/app/services/easy-genomics/run-cost-estimation-service', () => ({
  RunCostEstimationService: jest.fn().mockImplementation(() => ({
    estimate: (...args: unknown[]) => mockEstimate(...args),
    toPreRunCostEstimate: (...args: unknown[]) => mockToPreRunCostEstimate(...args),
  })),
}));
jest.mock('../../../../../../src/app/services/easy-genomics/run-input-profile-service', () => ({
  buildRunInputProfile: (...args: unknown[]) => mockBuildRunInputProfile(...args),
}));
jest.mock('../../../../../../src/app/services/sqs-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/create-laboratory-run.lambda';
import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { SqsService } from '../../../../../../src/app/services/sqs-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('create-laboratory-run.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const RUN_ID = '00000000-0000-0000-0000-000000000004';
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSqsService: jest.MockedClass<typeof SqsService>;
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
            'email': 'user@example.com',
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
    LaboratoryId: LAB_ID,
    RunId: RUN_ID,
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
    mockSqsService = SqsService as jest.MockedClass<typeof SqsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockRunService.prototype.addOrGetExisting = jest.fn();
    mockRunService.prototype.update = jest.fn().mockImplementation(async (r) => r);
    mockSqsService.prototype.sendMessage = jest.fn();
    mockBuildRunInputProfile.mockResolvedValue({
      SampleCount: 0,
      InputFileCount: 0,
      InputBytesTotal: 0,
      ParameterHash: 'hash',
    });
    mockEstimate.mockResolvedValue({
      estimateAvailable: false,
      confidence: 'NONE',
      comparableRunCount: 0,
      currency: 'USD',
      label: 'Estimated compute cost',
      disclaimer: 'unavailable',
      exclusions: [],
    });
    mockToPreRunCostEstimate.mockReturnValue(undefined);

    process.env.SQS_LABORATORY_RUN_UPDATE_QUEUE_URL = 'arn:aws:sns:region:acct:lab-run-update';
  });

  it('creates a laboratory run for an existing lab and queues status check when ExternalRunId is present', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.LaboratoryId).toBe(LAB_ID);
    expect(body.RunId).toBe(RUN_ID);
    expect(mockLabService.prototype.queryByLaboratoryId).toHaveBeenCalledWith(LAB_ID);
    expect(mockRunService.prototype.addOrGetExisting).toHaveBeenCalled();
    expect(mockSqsService.prototype.sendMessage).toHaveBeenCalled();
  });

  it('still returns 200 with the persisted run when queuing the status check fails', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    (mockSqsService.prototype.sendMessage as jest.Mock).mockRejectedValue(new Error('SQS unavailable'));

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.RunId).toBe(RUN_ID);
    expect(mockSqsService.prototype.sendMessage).toHaveBeenCalled();
  });

  it('passes WorkflowVersionName through to laboratory run addOrGetExisting when provided', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      Platform: 'AWS HealthOmics',
      WorkflowVersionName: 'my-omics-version',
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    const body = {
      ...baseRequest,
      Platform: 'AWS HealthOmics' as const,
      WorkflowVersionName: 'my-omics-version',
    };

    const result = await handler(createEvent(body), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockRunService.prototype.addOrGetExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        WorkflowVersionName: 'my-omics-version',
      }),
      'user-1',
    );
  });

  it('passes Description through to laboratory run addOrGetExisting when provided', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      Description: 'My run notes',
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    const body = {
      ...baseRequest,
      Description: 'My run notes',
    };

    const result = await handler(createEvent(body), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockRunService.prototype.addOrGetExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        Description: 'My run notes',
      }),
      'user-1',
    );
  });

  it('omits Description from laboratory run addOrGetExisting when not provided', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const addArg = (mockRunService.prototype.addOrGetExisting as jest.Mock).mock.calls[0][0];
    expect(addArg).not.toHaveProperty('Description');
  });

  it('does not queue status check when ExternalRunId is missing', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue({
      ...baseRequest,
      ExternalRunId: undefined,
      OrganizationId: 'org-1',
      Settings: JSON.stringify({}),
    });

    const body = { ...baseRequest, ExternalRunId: undefined };
    const result = await handler(createEvent(body), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockSqsService.prototype.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockRunService.prototype.addOrGetExisting).not.toHaveBeenCalled();
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
    expect(mockRunService.prototype.addOrGetExisting).not.toHaveBeenCalled();
  });

  it('sets PollStatus=ACTIVE on a newly created non-terminal run', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
    });
    const addOrGetExistingSpy = jest.fn().mockImplementation((run) => Promise.resolve(run));
    mockRunService.prototype.addOrGetExisting = addOrGetExistingSpy;

    const event = createEvent(baseRequest);
    await handler(event, createContext(), () => {});

    expect(addOrGetExistingSpy).toHaveBeenCalledWith(expect.objectContaining({ PollStatus: 'ACTIVE' }), 'user-1');
  });

  it('does not set PollStatus when the run is created already terminal', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
    });
    const addOrGetExistingSpy = jest.fn().mockImplementation((run) => Promise.resolve(run));
    mockRunService.prototype.addOrGetExisting = addOrGetExistingSpy;

    const event = createEvent({ ...baseRequest, Status: 'COMPLETED' });
    await handler(event, createContext(), () => {});

    expect(addOrGetExistingSpy).toHaveBeenCalledWith(expect.not.objectContaining({ PollStatus: 'ACTIVE' }), 'user-1');
  });

  it('persists the run before attaching cost estimate, and still succeeds if estimate fails', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
      S3Bucket: 'lab-bucket',
    });

    const added = {
      ...baseRequest,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
      CreatedBy: 'user-1',
    };
    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue(added);
    mockBuildRunInputProfile.mockRejectedValue(new Error('S3 timeout'));

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockRunService.prototype.addOrGetExisting).toHaveBeenCalled();
    expect(mockRunService.prototype.addOrGetExisting).toHaveBeenCalledWith(
      expect.not.objectContaining({ PreRunCostEstimate: expect.anything() }),
      'user-1',
    );
  });

  it('updates the run with RunInputProfile and PreRunCostEstimate after add', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
      S3Bucket: 'lab-bucket',
    });

    const added = {
      ...baseRequest,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Owner: 'user@example.com',
      Settings: JSON.stringify({ param: 'value' }),
      CreatedBy: 'user-1',
    };
    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockResolvedValue(added);
    mockBuildRunInputProfile.mockResolvedValue({
      SampleCount: 3,
      InputFileCount: 2,
      InputBytesTotal: 999,
      ParameterHash: 'abc',
    });
    mockEstimate.mockResolvedValue({
      estimateAvailable: true,
      confidence: 'HIGH',
      comparableRunCount: 8,
      computeCostUsd: { low: 1, median: 2, high: 3 },
      currency: 'USD',
      label: 'Estimated compute cost',
      disclaimer: 'd',
      exclusions: [],
    });
    mockToPreRunCostEstimate.mockReturnValue({
      LowUsd: 1,
      HighUsd: 3,
      MedianUsd: 2,
      Confidence: 'HIGH',
      ComparableRunCount: 8,
      EstimatedAt: '2026-01-01T00:00:00Z',
      Exclusions: [],
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockRunService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({
        RunInputProfile: expect.objectContaining({ SampleCount: 3 }),
        PreRunCostEstimate: expect.objectContaining({ MedianUsd: 2 }),
      }),
    );
  });

  it('returns a classified 400 (not a raw error) when addOrGetExisting reports a genuine RunId collision', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: LAB_ID,
    });

    (mockRunService.prototype.addOrGetExisting as jest.Mock).mockRejectedValue(new LaboratoryRunAlreadyExistsError());

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.ErrorCode).toBe('EG-336');
  });
});
