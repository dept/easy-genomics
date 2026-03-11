import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-laboratory-run-status-check.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/sns-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { SnsService } from '../../../../../../src/app/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('request-laboratory-run-status-check.lambda', () => {
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSnsService: jest.MockedClass<typeof SnsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    query: Record<string, string | undefined>,
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-status-check',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: query as any,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'request-laboratory-run-status-check',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:request-laboratory-run-status-check',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/request-laboratory-run-status-check',
      logStreamName: '2026/03/11/[$LATEST]test',
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

  it('returns 400 when laboratoryId query parameter is missing', async () => {
    const result = await handler(createEvent({}, { runIds: ['run-1'] }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(
      createEvent({ laboratoryId: 'lab-1' }, { runIds: ['run-1'] }),
      createContext(),
      () => {},
    );

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

    const result = await handler(
      createEvent({ laboratoryId: 'lab-1' }, { runIds: ['run-1'] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when runIds are missing or empty', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(createEvent({ laboratoryId: 'lab-1' }, {}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('queues status checks only for non-terminal runs belonging to the lab', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockRunService.prototype.queryByRunId as jest.Mock)
      .mockResolvedValueOnce({
        RunId: 'run-1',
        LaboratoryId: 'lab-1',
        Status: 'RUNNING',
      })
      .mockResolvedValueOnce({
        RunId: 'run-2',
        LaboratoryId: 'lab-1',
        Status: 'COMPLETED',
      })
      .mockResolvedValueOnce({
        RunId: 'run-3',
        LaboratoryId: 'other-lab',
        Status: 'RUNNING',
      });

    const result = await handler(
      createEvent({ laboratoryId: 'lab-1' }, { runIds: ['run-1', 'run-2', 'run-3'] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Count).toBe(1);
    expect(mockSnsService.prototype.publish).toHaveBeenCalledTimes(1);
  });
});
