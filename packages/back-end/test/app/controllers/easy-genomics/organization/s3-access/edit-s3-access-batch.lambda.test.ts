import { Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/organization/s3-access/edit-s3-access-batch.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryS3AccessService } from '../../../../../../src/app/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../../src/app/utils/auth-utils';

describe('edit-s3-access-batch.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryS3AccessService>;

  const createEvent = (organizationId: string | undefined, body: any) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/organization/s3-access/edit-s3-access-batch',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'admin@example.com',
            'cognito:username': 'admin-user',
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
      functionName: 'edit-s3-access-batch',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:edit-s3-access-batch',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/edit-s3-access-batch',
      logStreamName: '2026/07/16/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  const makeLab = (overrides: Partial<Record<string, unknown>> = {}) => ({
    OrganizationId: ORG_ID,
    LaboratoryId: LAB_ID,
    Name: 'Lab A',
    Status: 'Active',
    EnableNewBucketsByDefault: false,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockAccessService = LaboratoryS3AccessService as jest.MockedClass<typeof LaboratoryS3AccessService>;

    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);

    mockLabService.prototype.queryByOrganizationId = jest.fn();
    mockLabService.prototype.update = jest.fn().mockResolvedValue(undefined);
    mockAccessService.prototype.upsert = jest.fn().mockResolvedValue(undefined);
    mockAccessService.prototype.remove = jest.fn().mockResolvedValue(undefined);
  });

  it('clears the lab default bucket when access to it is revoked (strict mode)', async () => {
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      makeLab({ S3Bucket: 'bucket-a', EnableNewBucketsByDefault: false }),
    ]);

    const result = await handler(
      createEvent(ORG_ID, { assignments: [{ laboratoryId: LAB_ID, bucketName: 'bucket-a', granted: false }] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockAccessService.prototype.remove).toHaveBeenCalledWith(LAB_ID, 'bucket-a');
    expect(mockLabService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: LAB_ID, S3Bucket: undefined, ModifiedBy: 'admin-user' }),
      expect.objectContaining({ LaboratoryId: LAB_ID }),
    );
    expect(JSON.parse(result.body)).toEqual(
      expect.objectContaining({
        ok: true,
        clearedDefaults: [{ laboratoryId: LAB_ID, bucketName: 'bucket-a' }],
      }),
    );
  });

  it('clears the lab default bucket when access to it is revoked (default-on mode)', async () => {
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      makeLab({ S3Bucket: 'bucket-a', EnableNewBucketsByDefault: true }),
    ]);

    const result = await handler(
      createEvent(ORG_ID, { assignments: [{ laboratoryId: LAB_ID, bucketName: 'bucket-a', granted: false }] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockAccessService.prototype.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: LAB_ID, BucketName: 'bucket-a', Effect: 'DENY' }),
    );
    expect(mockLabService.prototype.update).toHaveBeenCalled();
    expect(JSON.parse(result.body).clearedDefaults).toEqual([{ laboratoryId: LAB_ID, bucketName: 'bucket-a' }]);
  });

  it('does not clear the default when a non-default bucket is revoked', async () => {
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      makeLab({ S3Bucket: 'bucket-a', EnableNewBucketsByDefault: false }),
    ]);

    const result = await handler(
      createEvent(ORG_ID, { assignments: [{ laboratoryId: LAB_ID, bucketName: 'bucket-b', granted: false }] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).clearedDefaults).toEqual([]);
  });

  it('does not clear the default when granting access', async () => {
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      makeLab({ S3Bucket: 'bucket-a', EnableNewBucketsByDefault: false }),
    ]);

    const result = await handler(
      createEvent(ORG_ID, { assignments: [{ laboratoryId: LAB_ID, bucketName: 'bucket-a', granted: true }] }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockAccessService.prototype.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ BucketName: 'bucket-a', Effect: 'ALLOW' }),
    );
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).clearedDefaults).toEqual([]);
  });

  it('returns 403 when caller is not an admin', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(createEvent(ORG_ID, { assignments: [] }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });
});
