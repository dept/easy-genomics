import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/update-laboratory-run.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/sns-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { SnsService } from '../../../../../../src/app/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('update-laboratory-run.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const RUN_ID = '00000000-0000-0000-0000-000000000004';

  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockSnsService: jest.MockedClass<typeof SnsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  let mockQueryByRunId: jest.Mock;
  let mockUpdateRun: jest.Mock;
  let mockPublish: jest.Mock;

  const createEvent = (
    id: string | undefined,
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'PUT',
      path: `/laboratory/run/${id ?? ''}`,
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
      pathParameters: id ? { id } : null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'update-laboratory-run',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:update-laboratory-run',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/update-laboratory-run',
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
    Status: 'RUNNING',
    Settings: { param: 'new' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockSnsService = SnsService as jest.MockedClass<typeof SnsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockQueryByRunId = jest.fn();
    mockUpdateRun = jest.fn();
    mockPublish = jest.fn();

    mockRunService.prototype.queryByRunId = mockQueryByRunId;
    mockRunService.prototype.update = mockUpdateRun;
    mockSnsService.prototype.publish = mockPublish;

    process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC = 'arn:aws:sns:region:acct:lab-run-update';
  });

  it('returns 400 when id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent(RUN_ID, {}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('returns 404 when run is not found', async () => {
    mockQueryByRunId.mockResolvedValue(undefined);

    const result = await handler(createEvent(RUN_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('denies access when caller is not org admin or lab manager/technician', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: RUN_ID,
      LaboratoryId: LAB_ID,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Settings: '{}',
    });
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(RUN_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('updates laboratory run and publishes SNS event when caller has access', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: RUN_ID,
      LaboratoryId: LAB_ID,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Status: 'PENDING',
      Settings: '{}',
    });

    mockUpdateRun.mockResolvedValue({
      RunId: RUN_ID,
      LaboratoryId: LAB_ID,
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      Status: 'RUNNING',
      Settings: JSON.stringify({ param: 'new' }),
    });

    const result = await handler(createEvent(RUN_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('RUNNING');
    expect(mockRunService.prototype.update).toHaveBeenCalled();
    expect(mockSnsService.prototype.publish).toHaveBeenCalled();
    expect(mockUpdateRun).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalled();
  });
});
