import { LaboratoryUserNotFoundError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/request-laboratory-user.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');

import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';

const LAB_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const MISSING_USER_ID = '00000000-0000-0000-0000-000000000099';

describe('request-laboratory-user.lambda', () => {
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/user/request',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'admin@example.com',
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
      functionName: 'request-laboratory-user',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:request-laboratory-user',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/request-laboratory-user',
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
    mockLabUserService.prototype.get = jest.fn();
  });

  it('returns laboratory user when request is valid', async () => {
    (mockLabUserService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
      UserId: USER_ID,
    });

    const result = await handler(createEvent({ LaboratoryId: LAB_ID, UserId: USER_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.UserId).toBe(USER_ID);
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockLabUserService.prototype.get).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory user is not found', async () => {
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValue(
      new LaboratoryUserNotFoundError(LAB_ID, MISSING_USER_ID),
    );

    const result = await handler(
      createEvent({ LaboratoryId: LAB_ID, UserId: MISSING_USER_ID }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(404);
  });

  it('returns non-200 when body cannot be parsed as JSON', async () => {
    const badEvent = createEvent({} as any);
    (badEvent as any).body = '{invalid-json';

    const result = await handler(badEvent, createContext(), () => {});

    expect(result.statusCode).not.toBe(200);
  });

  it('returns 400 when an unexpected error occurs in service', async () => {
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValue(new Error('unexpected failure'));

    const result = await handler(createEvent({ LaboratoryId: LAB_ID, UserId: USER_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });
});
