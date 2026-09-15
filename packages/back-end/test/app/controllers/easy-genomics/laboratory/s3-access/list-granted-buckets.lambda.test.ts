process.env.NAME_PREFIX = 'unit-test';

import { Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/s3-access/list-granted-buckets.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../../src/app/services/easy-genomics/s3-bucket-catalog-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryS3AccessService } from '../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { listDataTaggedS3Buckets } from '../../../../../../src/app/services/easy-genomics/s3-bucket-catalog-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('list-granted-buckets.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryS3AccessService>;

  const createEvent = (laboratoryId?: string) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/s3-access/list-granted-buckets',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'user@example.com',
            'cognito:username': 'user',
          },
        },
      },
      resource: '',
      queryStringParameters: laboratoryId ? { laboratoryId } : null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'list-granted-buckets',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-granted-buckets',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-granted-buckets',
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
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      EnableNewBucketsByDefault: false,
      S3Bucket: 'bucket-a',
    });
    mockAccessService.prototype.listByLaboratoryId = jest.fn();
    (listDataTaggedS3Buckets as jest.Mock).mockResolvedValue([{ name: 'bucket-a' }, { name: 'bucket-b' }]);
  });

  it('returns 400 when laboratoryId is missing', async () => {
    const result = await handler(createEvent(), createContext(), () => {});
    expect(result.statusCode).toBe(400);
  });

  it('returns 403 when caller lacks lab/org access', async () => {
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    const result = await handler(createEvent(LAB_ID), createContext(), () => {});
    expect(result.statusCode).toBe(403);
  });

  it('returns ALLOW buckets in strict mode', async () => {
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, BucketName: 'bucket-a', OrganizationId: ORG_ID, Effect: 'ALLOW' },
    ]);

    const result = await handler(createEvent(LAB_ID), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ buckets: ['bucket-a'] });
  });

  it('returns catalog minus DENY in default-on mode', async () => {
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      EnableNewBucketsByDefault: true,
    });
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, BucketName: 'bucket-a', OrganizationId: ORG_ID, Effect: 'DENY' },
    ]);

    const result = await handler(createEvent(LAB_ID), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ buckets: ['bucket-b'] });
  });

  it('does not return a legacy configured default when it is off-catalog and there are zero access rows', async () => {
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      EnableNewBucketsByDefault: false,
      S3Bucket: 'stale-bucket',
    });
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([]);

    const result = await handler(createEvent(LAB_ID), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ buckets: [] });
  });
});
