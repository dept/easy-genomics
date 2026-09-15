process.env.NAME_PREFIX = 'unit-test';

import { Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/organization/s3-access/list-s3-access-assignments.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryS3AccessService } from '../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../../src/app/utils/auth-utils';

describe('list-s3-access-assignments.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_A = '00000000-0000-0000-0000-000000000002';
  const LAB_B = '00000000-0000-0000-0000-000000000003';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryS3AccessService>;

  const createEvent = (organizationId?: string) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/organization/s3-access/list-s3-access-assignments',
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
      functionName: 'list-s3-access-assignments',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-s3-access-assignments',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-s3-access-assignments',
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
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockAccessService = LaboratoryS3AccessService as jest.MockedClass<typeof LaboratoryS3AccessService>;

    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);

    mockLabService.prototype.queryByOrganizationId = jest.fn().mockResolvedValue([
      { OrganizationId: ORG_ID, LaboratoryId: LAB_A },
      { OrganizationId: ORG_ID, LaboratoryId: LAB_B },
    ]);
    mockAccessService.prototype.listByLaboratoryId = jest.fn();
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

  it('fans out over org labs and flattens assignments', async () => {
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock)
      .mockResolvedValueOnce([{ LaboratoryId: LAB_A, BucketName: 'bucket-a', OrganizationId: ORG_ID, Effect: 'ALLOW' }])
      .mockResolvedValueOnce([{ LaboratoryId: LAB_B, BucketName: 'bucket-b', OrganizationId: ORG_ID, Effect: 'DENY' }]);

    const result = await handler(createEvent(ORG_ID), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      assignments: [
        { LaboratoryId: LAB_A, BucketName: 'bucket-a', OrganizationId: ORG_ID, Effect: 'ALLOW' },
        { LaboratoryId: LAB_B, BucketName: 'bucket-b', OrganizationId: ORG_ID, Effect: 'DENY' },
      ],
    });
    expect(mockAccessService.prototype.listByLaboratoryId).toHaveBeenCalledTimes(2);
  });
});
