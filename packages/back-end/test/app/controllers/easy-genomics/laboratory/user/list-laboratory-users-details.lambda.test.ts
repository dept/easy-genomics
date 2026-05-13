import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import {
  handler,
  listLaboratoryUsers,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/list-laboratory-users-details.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/user-service');

import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';
import { UserService } from '../../../../../../src/app/services/easy-genomics/user-service';

describe('list-laboratory-users-details.lambda', () => {
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;
  let mockUserService: jest.MockedClass<typeof UserService>;

  const createEvent = (
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/user/list-details',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'admin@example.com',
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
      functionName: 'list-laboratory-users-details',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-laboratory-users-details',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-laboratory-users-details',
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
    mockLabUserService = LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>;
    mockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockLabUserService.prototype.queryByOrganizationId = jest.fn();
    mockLabUserService.prototype.queryByLaboratoryId = jest.fn();
    mockLabUserService.prototype.queryByUserId = jest.fn();
    mockUserService.prototype.listUsers = jest.fn();
  });

  it('returns empty list when no laboratory users are found', async () => {
    (mockLabUserService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([]);

    const result = await handler(createEvent({ laboratoryId: 'lab-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });

  it('joins laboratory users with user details for organizationId query', async () => {
    (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1', LabManager: true, LabTechnician: false },
    ]);
    (mockUserService.prototype.listUsers as jest.Mock).mockResolvedValue([
      {
        UserId: 'user-1',
        Email: 'user@example.com',
        PreferredName: 'P',
        FirstName: 'First',
        LastName: 'Last',
      },
    ]);

    const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].UserEmail).toBe('user@example.com');
    expect(body[0].LabManager).toBe(true);
  });

  it('ignores laboratory users without matching user records', async () => {
    (mockLabUserService.prototype.queryByUserId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1', LabManager: true, LabTechnician: false },
    ]);
    (mockUserService.prototype.listUsers as jest.Mock).mockResolvedValue([]);

    const result = await handler(createEvent({ userId: 'user-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });

  it('returns 400 when query combination is invalid', async () => {
    const result = await handler(
      createEvent({ organizationId: 'org-1', laboratoryId: 'lab-1' }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  describe('listLaboratoryUsers helper', () => {
    it('queries by organizationId only', async () => {
      (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
        { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
      ]);

      const res = await listLaboratoryUsers('org-1', undefined, undefined);
      expect(res).toHaveLength(1);
      expect(mockLabUserService.prototype.queryByOrganizationId).toHaveBeenCalledWith('org-1');
    });

    it('queries by laboratoryId only', async () => {
      (mockLabUserService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([
        { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
      ]);

      const res = await listLaboratoryUsers(undefined, 'lab-1', undefined);
      expect(res).toHaveLength(1);
      expect(mockLabUserService.prototype.queryByLaboratoryId).toHaveBeenCalledWith('lab-1');
    });

    it('queries by userId only', async () => {
      (mockLabUserService.prototype.queryByUserId as jest.Mock).mockResolvedValue([
        { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
      ]);

      const res = await listLaboratoryUsers(undefined, undefined, 'user-1');
      expect(res).toHaveLength(1);
      expect(mockLabUserService.prototype.queryByUserId).toHaveBeenCalledWith('user-1');
    });

    it('throws InvalidRequestError for invalid combinations', () => {
      expect(() => listLaboratoryUsers(undefined, undefined, undefined)).toThrow();
      expect(() => listLaboratoryUsers('org-1', 'lab-1', undefined)).toThrow();
      expect(() => listLaboratoryUsers('org-1', undefined, 'user-1')).toThrow();
    });
  });

  describe('handler failure cases', () => {
    it('returns 400 when laboratory user query fails', async () => {
      (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockRejectedValue(new Error('db failure'));

      const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when userService.listUsers fails', async () => {
      (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
        { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1', LabManager: true, LabTechnician: false },
      ]);
      (mockUserService.prototype.listUsers as jest.Mock).mockRejectedValue(new Error('user lookup failure'));

      const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

      expect(result.statusCode).toBe(400);
    });
  });
});
