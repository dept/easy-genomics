import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-top-level-bucket-objects.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('request-top-level-bucket-objects Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetLaboratoryRun: jest.Mock;
  let mockListBucketObjectsV2: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
  };

  const mockRun = {
    LaboratoryId: 'test-lab-id',
    RunId: 'run-123',
    OutputS3Url: 's3://test-bucket/custom/output/',
  };

  const createMockEvent = (body: any): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-top-level-bucket-objects',
    headers: {},
    requestContext: {
      requestId: 'request-id',
      extendedRequestId: 'extended-request-id',
      authorizer: { claims: { email: 'test@example.com' } },
    } as any,
    resource: '',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
  });

  const createMockContext = (): Context => ({
    functionName: 'request-top-level-bucket-objects',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-top-level-bucket-objects',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-top-level-bucket-objects',
    logStreamName: '2026/03/17/[$LATEST]test',
    identity: undefined,
    clientContext: undefined,
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.MockedFunction<
      typeof validateOrganizationAdminAccess
    >;
    mockValidateLabManager = validateLaboratoryManagerAccess as jest.MockedFunction<
      typeof validateLaboratoryManagerAccess
    >;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as jest.MockedFunction<
      typeof validateLaboratoryTechnicianAccess
    >;

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const mockLaboratoryServiceInstance = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockQueryByLaboratoryId = jest.fn();
    mockLaboratoryServiceInstance.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;

    const mockLaboratoryRunServiceInstance = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockGetLaboratoryRun = jest.fn();
    mockLaboratoryRunServiceInstance.prototype.get = mockGetLaboratoryRun;

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBucketObjectsV2 = jest.fn();
    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
  });

  it('allows listing when RunId is provided and requested prefix is under OutputS3Url (custom output dir)', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue(mockRun);
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [
        {
          Key: 'custom/output/subdir/file.txt',
          Size: 1,
          LastModified: '2026-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
      ],
      CommonPrefixes: [{ Prefix: 'custom/output/subdir/nested/' }],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'test-bucket',
        S3Prefix: 'custom/output/subdir',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Prefix: 'custom/output/subdir/',
        Delimiter: '/',
      }),
    );
  });

  it('allows listing at the immediate parent of OutputS3Url (e.g. run root when OutputS3Url points to results/)', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue({
      ...mockRun,
      OutputS3Url: 's3://test-bucket/custom/output/results/',
    });
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [],
      CommonPrefixes: [{ Prefix: 'custom/output/results/' }],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'test-bucket',
        S3Prefix: 'custom/output/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Prefix: 'custom/output/',
      }),
    );
  });

  it('denies listing when RunId is provided but requested prefix is outside OutputS3Url', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue(mockRun);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'test-bucket',
        S3Prefix: 'other/prefix/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalled();
  });

  it('denies listing when RunId is provided but S3Bucket mismatches run OutputS3Url bucket', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue(mockRun);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'another-bucket',
        S3Prefix: 'custom/output/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalled();
  });

  it('allows listing when RunId is provided and run OutputS3Url bucket differs from lab S3Bucket', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue({
      ...mockRun,
      OutputS3Url: 's3://another-bucket/custom/output/results/',
    });
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [],
      CommonPrefixes: [{ Prefix: 'custom/output/results/sub/' }],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'another-bucket',
        S3Prefix: 'custom/output/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'another-bucket',
        Prefix: 'custom/output/results/',
        Delimiter: '/',
      }),
    );
  });

  it('defaults to the run OutputS3Url prefix when RunId is provided and S3Prefix is omitted', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockGetLaboratoryRun.mockResolvedValue(mockRun);
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [],
      CommonPrefixes: [{ Prefix: 'custom/output/subdir/' }],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        RunId: 'run-123',
        S3Bucket: 'test-bucket',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Prefix: 'custom/output/',
      }),
    );
  });

  it('keeps legacy behavior when RunId is omitted (prefix must be under org/lab)', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'custom/output/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalled();
  });
});
