process.env.NAME_PREFIX = 'unit-test';

import { Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/organization/s3-access/list-s3-bucket-catalog.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/s3-bucket-catalog-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { listDataTaggedS3Buckets } from '../../../../../../src/app/services/easy-genomics/s3-bucket-catalog-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../../src/app/utils/auth-utils';

describe('list-s3-bucket-catalog.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';

  const createEvent = (organizationId?: string) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/organization/s3-access/list-s3-bucket-catalog',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'admin@example.com',
            'cognito:username': 'admin',
          },
        },
      },
      resource: '',
      queryStringParameters: organizationId ? { organizationId } : null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'list-s3-bucket-catalog',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-s3-bucket-catalog',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-s3-bucket-catalog',
      logStreamName: '2026/07/28/[$LATEST]test',
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
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (listDataTaggedS3Buckets as jest.Mock).mockResolvedValue([{ name: 'bucket-a' }]);
  });

  it('returns 400 when organizationId is missing', async () => {
    const result = await handler(createEvent(), createContext(), () => {});
    expect(result.statusCode).toBe(400);
  });

  it('returns 403 when caller is not an admin', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    const result = await handler(createEvent(ORG_ID), createContext(), () => {});
    expect(result.statusCode).toBe(403);
  });

  it('returns the catalog for org admins', async () => {
    const result = await handler(createEvent(ORG_ID), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ buckets: [{ name: 'bucket-a' }] });
  });
});
