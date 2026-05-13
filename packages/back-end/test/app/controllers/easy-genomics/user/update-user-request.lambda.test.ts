import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockQueryByEmail = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/user-service', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    queryByEmail: mockQueryByEmail,
    update: mockUpdate,
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/user/update-user-request.lambda';

describe('update-user-request.lambda', () => {
  const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
  const USER_EMAIL = 'user@example.com';

  const existingUser = {
    UserId: USER_ID,
    Email: USER_EMAIL,
    FirstName: 'Jane',
    LastName: 'Doe',
    Status: 'Active',
  };

  const createEvent = (
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'PUT',
      path: `/easy-genomics/user/update-user-request/${USER_ID}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': USER_EMAIL,
            'cognito:username': USER_ID,
          },
        },
      },
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: { id: USER_ID },
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'update-user-request',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:update-user-request',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/update-user-request',
      logStreamName: '2026/04/10/[$LATEST]test',
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
    mockQueryByEmail.mockResolvedValue([existingUser]);
    mockUpdate.mockImplementation(async (updated: any) => updated);
  });

  it('updates user with FavouriteWorkflows', async () => {
    const favourites = [
      {
        WorkflowId: 'wf-1',
        WorkflowName: 'rnaseq',
        Description: 'RNA sequencing pipeline',
        Platform: 'AWS HealthOmics',
        LaboratoryId: 'lab-1',
      },
    ];

    const result = await handler(createEvent({ FavouriteWorkflows: favourites }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.FavouriteWorkflows).toEqual(favourites);
  });

  it('clears FavouriteWorkflows with an empty array', async () => {
    const result = await handler(createEvent({ FavouriteWorkflows: [] }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.FavouriteWorkflows).toEqual([]);
  });

  it('updates user with multiple favourite workflows across platforms', async () => {
    const favourites = [
      {
        WorkflowId: 'wf-1',
        WorkflowName: 'rnaseq',
        Platform: 'AWS HealthOmics',
        LaboratoryId: 'lab-1',
      },
      {
        WorkflowId: '42',
        WorkflowName: 'nf-core/sarek',
        Description: 'Variant calling pipeline',
        Platform: 'Seqera Cloud',
        LaboratoryId: 'lab-2',
      },
    ];

    const result = await handler(createEvent({ FavouriteWorkflows: favourites }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.FavouriteWorkflows).toHaveLength(2);
    expect(updatedUser.FavouriteWorkflows[0].Platform).toBe('AWS HealthOmics');
    expect(updatedUser.FavouriteWorkflows[1].Platform).toBe('Seqera Cloud');
  });

  it('preserves existing user fields when updating FavouriteWorkflows', async () => {
    const result = await handler(
      createEvent({
        FavouriteWorkflows: [
          {
            WorkflowId: 'wf-1',
            WorkflowName: 'pipeline',
            Platform: 'AWS HealthOmics',
            LaboratoryId: 'lab-1',
          },
        ],
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.FirstName).toBe('Jane');
    expect(updatedUser.LastName).toBe('Doe');
    expect(updatedUser.Email).toBe(USER_EMAIL);
  });

  it('updates FavouriteWorkflows alongside other fields', async () => {
    const result = await handler(
      createEvent({
        FirstName: 'Updated',
        FavouriteWorkflows: [
          {
            WorkflowId: 'wf-1',
            WorkflowName: 'pipeline',
            Platform: 'Seqera Cloud',
            LaboratoryId: 'lab-1',
          },
        ],
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.FirstName).toBe('Updated');
    expect(updatedUser.FavouriteWorkflows).toHaveLength(1);
  });

  it('rejects update with invalid FavouriteWorkflows entry', async () => {
    const result = await handler(
      createEvent({
        FavouriteWorkflows: [{ WorkflowId: 'wf-1' }],
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects update with invalid Platform in FavouriteWorkflows', async () => {
    const result = await handler(
      createEvent({
        FavouriteWorkflows: [
          {
            WorkflowId: 'wf-1',
            WorkflowName: 'pipeline',
            Platform: 'Invalid Platform',
            LaboratoryId: 'lab-1',
          },
        ],
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 when user id does not match token', async () => {
    const event = createEvent({ FavouriteWorkflows: [] }, { pathParameters: { id: 'different-user-id' } });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when path parameter id is missing', async () => {
    const event = createEvent({ FavouriteWorkflows: [] }, { pathParameters: null });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not found by email', async () => {
    mockQueryByEmail.mockResolvedValue([]);

    const result = await handler(createEvent({ FavouriteWorkflows: [] }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
