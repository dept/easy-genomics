import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockQueryByLaboratoryId = jest.fn();
const mockListTags = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: mockQueryByLaboratoryId,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/data-collection-service', () => ({
  DataCollectionService: jest.fn().mockImplementation(() => ({
    listTags: mockListTags,
  })),
}));

jest.mock('../../../../../src/app/controllers/easy-genomics/data-collection/data-collection-auth');

import { assertCanAccessLaboratoryDataCollections } from '../../../../../src/app/controllers/easy-genomics/data-collection/data-collection-auth';
import { handler } from '../../../../../src/app/controllers/easy-genomics/data-collection/list-data-collection-tags.lambda';

describe('list-data-collection-tags Lambda', () => {
  const mockLaboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    Name: 'Lab',
  };

  const createMockEvent = (query: Record<string, string>): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/data-collection/list-data-collection-tags',
      queryStringParameters: query,
      headers: {},
      requestContext: {
        requestId: 'req-1',
        extendedRequestId: 'ext-1',
        authorizer: {
          claims: {
            email: 'test@example.com',
          },
        },
      } as any,
      resource: '',
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createMockContext = (): Context =>
    ({
      functionName: 'list-data-collection-tags',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:list-data-collection-tags',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/list-data-collection-tags',
      logStreamName: '2025/02/18/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (
      assertCanAccessLaboratoryDataCollections as jest.MockedFunction<typeof assertCanAccessLaboratoryDataCollections>
    ).mockImplementation(() => {});
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockListTags.mockResolvedValue([{ TagId: 't1', Name: 'Flu', Color: '#97C459' }]);
  });

  it('returns tags when authorized', async () => {
    const event = createMockEvent({ LaboratoryId: 'lab-1' });
    const res = await handler(event, createMockContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body || '{}');
    expect(body.Tags).toHaveLength(1);
    expect(body.Tags[0].TagId).toBe('t1');
    expect(mockListTags).toHaveBeenCalledWith('lab-1');
  });

  it('rejects missing LaboratoryId', async () => {
    const event = createMockEvent({});
    const res = await handler(event, createMockContext(), () => {});
    expect(res?.statusCode).not.toBe(200);
  });
});
