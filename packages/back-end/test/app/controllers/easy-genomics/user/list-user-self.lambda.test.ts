import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockGet = jest.fn();
const mockQueryByEmail = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/user-service', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    get: mockGet,
    queryByEmail: mockQueryByEmail,
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/user/list-user-self.lambda';

describe('list-user-self.lambda', () => {
  const createEvent = (overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/easy-genomics/user/list-user-self',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'user@example.com',
            'UserId': 'user-123',
            'cognito:username': 'user-123',
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
      functionName: 'list-user-self',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-user-self',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-user-self',
      logStreamName: '2026/03/24/[$LATEST]test',
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
    mockGet.mockReset();
    mockQueryByEmail.mockReset();
  });

  it('returns current user details from token UserId claim', async () => {
    mockGet.mockResolvedValue({
      UserId: 'user-123',
      Email: 'user@example.com',
      Status: 'Active',
      OmicsWorkflowDefaultParams: {
        workflow1: { paramA: 'valueA' },
      },
    });

    const result = await handler(createEvent(), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockGet).toHaveBeenCalledWith('user-123');
    expect(mockQueryByEmail).not.toHaveBeenCalled();
    const body = JSON.parse(result.body);
    expect(body.UserId).toBe('user-123');
    expect(body.OmicsWorkflowDefaultParams.workflow1.paramA).toBe('valueA');
  });

  it('falls back to email lookup when UserId claim is missing', async () => {
    mockQueryByEmail.mockResolvedValue([
      {
        UserId: 'user-123',
        Email: 'user@example.com',
        Status: 'Active',
      },
    ]);

    const event = createEvent({
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      } as any,
    });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockQueryByEmail).toHaveBeenCalledWith('user@example.com');
  });

  it('returns unauthorized when token has no email', async () => {
    const event = createEvent({
      requestContext: {
        authorizer: {
          claims: {
            'cognito:username': 'user-123',
          },
        },
      } as any,
    });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockQueryByEmail).not.toHaveBeenCalled();
  });

  it('returns unauthorized when no user is found for authenticated email fallback', async () => {
    mockQueryByEmail.mockResolvedValue([]);
    const event = createEvent({
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      } as any,
    });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when user service throws unexpected error', async () => {
    mockGet.mockRejectedValue(new Error('database unavailable'));

    const result = await handler(createEvent(), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });
});
