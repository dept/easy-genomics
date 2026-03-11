import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/list-laboratory-runs.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../../src/app/utils/rest-api-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';
import { getFilterResults, getFilters } from '../../../../../../src/app/utils/rest-api-utils';

describe('list-laboratory-runs.lambda', () => {
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/run/list',
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
      functionName: 'list-laboratory-runs',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-laboratory-runs',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-laboratory-runs',
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
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  it('returns 400 when LaboratoryId query parameter is missing', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent({ LaboratoryId: 'lab-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('denies access when caller is not org admin or lab manager/technician', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent({ LaboratoryId: 'lab-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('lists runs for owned laboratory without filters', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    (mockRunService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([
      { RunId: 'run-1', LaboratoryId: 'lab-1', OrganizationId: 'org-1', Settings: '{}' },
    ]);

    const result = await handler(createEvent({ LaboratoryId: 'lab-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].RunId).toBe('run-1');
    expect(body[0].Settings).toEqual({});
  });

  it('applies filters from query parameters safely', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    const runs = [
      { RunId: 'run-1', LaboratoryId: 'lab-1', OrganizationId: 'org-1', Status: 'RUNNING', Settings: '{}' },
      { RunId: 'run-2', LaboratoryId: 'lab-1', OrganizationId: 'org-1', Status: 'FAILED', Settings: '{}' },
    ];
    (mockRunService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(runs);

    const result = await handler(
      createEvent({
        LaboratoryId: 'lab-1',
        Status: 'FAILED',
        UnknownParam: 'ignored',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(2);
    expect(getFilters).toHaveBeenCalled();
    expect(getFilterResults).toHaveBeenCalled();
  });
});
