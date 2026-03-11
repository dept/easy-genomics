import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/read-laboratory-run.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('read-laboratory-run.lambda', () => {
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (id: string | undefined, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: `/laboratory/run/${id ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
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
      functionName: 'read-laboratory-run',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:read-laboratory-run',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/read-laboratory-run',
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
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  it('returns 400 when id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when run is not found', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent('run-1'), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('denies access when caller is not org admin or lab manager/technician', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      Settings: '{}',
    });
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent('run-1'), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('returns laboratory run with parsed Settings when user has access', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      Status: 'RUNNING',
      Settings: '{"param":"value"}',
    });

    const result = await handler(createEvent('run-1'), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.RunId).toBe('run-1');
    expect(body.Settings).toEqual({ param: 'value' });
  });
});
