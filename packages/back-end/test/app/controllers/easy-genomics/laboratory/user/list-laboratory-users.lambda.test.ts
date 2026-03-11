import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import {
  handler,
  listLaboratoryUsers,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/list-laboratory-users.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');

import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';

describe('list-laboratory-users.lambda', () => {
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;

  const createEvent = (
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/user/list',
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
      functionName: 'list-laboratory-users',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-laboratory-users',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-laboratory-users',
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
  });

  it('lists users by organizationId', async () => {
    (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
    ]);

    const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(mockLabUserService.prototype.queryByOrganizationId).toHaveBeenCalledWith('org-1');
  });

  it('lists users by laboratoryId', async () => {
    (mockLabUserService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
    ]);

    const result = await handler(createEvent({ laboratoryId: 'lab-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(mockLabUserService.prototype.queryByLaboratoryId).toHaveBeenCalledWith('lab-1');
  });

  it('lists users by userId', async () => {
    (mockLabUserService.prototype.queryByUserId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1', UserId: 'user-1' },
    ]);

    const result = await handler(createEvent({ userId: 'user-1' }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(mockLabUserService.prototype.queryByUserId).toHaveBeenCalledWith('user-1');
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

    it('throws InvalidRequestError for invalid argument combinations', async () => {
      await expect(listLaboratoryUsers(undefined, undefined, undefined)).rejects.toThrow();
      await expect(listLaboratoryUsers('org-1', 'lab-1', undefined)).rejects.toThrow();
      await expect(listLaboratoryUsers('org-1', undefined, 'user-1')).rejects.toThrow();
    });
  });

  describe('handler failure cases', () => {
    it('returns 500 when underlying query throws unexpected error', async () => {
      (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockRejectedValue(new Error('db failure'));

      const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

      expect(result.statusCode).toBe(500);
    });

    it('returns 500 when listLaboratoryUsers returns undefined', async () => {
      (mockLabUserService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue(undefined as any);

      const result = await handler(createEvent({ organizationId: 'org-1' }), createContext(), () => {});

      expect(result.statusCode).toBe(500);
    });
  });
});
