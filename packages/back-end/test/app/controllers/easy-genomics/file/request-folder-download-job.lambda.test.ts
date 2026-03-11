import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-folder-download-job.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/services/sns-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import { SnsService } from '../../../../../src/app/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('request-folder-download-job Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockPutObject: jest.Mock;
  let mockPublish: jest.Mock;
  let mockListBucketObjectsV2: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockDeleteObject: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
  };

  const createMockEvent = (body: any): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-folder-download-job',
    headers: {},
    requestContext: {
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
    functionName: 'request-folder-download-job',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-folder-download-job',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-folder-download-job',
    logStreamName: '2026/03/06/[$LATEST]test',
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

    process.env.SNS_FOLDER_DOWNLOAD_TOPIC = 'arn:aws:sns:us-east-1:123:folder-download-topic.fifo';

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

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockPutObject = jest.fn();
    mockListBucketObjectsV2 = jest.fn();
    mockGetObject = jest.fn();
    mockDeleteObject = jest.fn();
    mockS3ServiceInstance.prototype.putObject = mockPutObject;
    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
    mockS3ServiceInstance.prototype.getObject = mockGetObject;
    mockS3ServiceInstance.prototype.deleteObject = mockDeleteObject;
    mockListBucketObjectsV2.mockImplementation(({ Prefix }: { Prefix: string }) => {
      if (Prefix.includes('.downloads/jobs/')) {
        return Promise.resolve({
          Contents: [],
          IsTruncated: false,
        });
      }
      return Promise.resolve({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/a.txt', Size: 100 }],
        IsTruncated: false,
      });
    });

    const mockSnsServiceInstance = SnsService as jest.MockedClass<typeof SnsService>;
    mockPublish = jest.fn();
    mockSnsServiceInstance.prototype.publish = mockPublish;
  });

  it('creates a folder download job when user is authorized', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockPutObject.mockResolvedValue({});
    mockPublish.mockResolvedValue({});

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.JobId).toBeTruthy();
    expect(body.Status).toBe('PENDING');
    expect(mockPutObject).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalled();
    expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(2);
  });

  it('rejects requests outside laboratory prefix', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'another-org/another-lab/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('supports S3 URI prefixes and resolves bucket from URI', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockPutObject.mockResolvedValue({});
    mockPublish.mockResolvedValue({});

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Prefix: 's3://test-bucket/test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockPutObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
      }),
    );
  });

  it('returns 400 on bucket mismatch between S3Bucket and S3Prefix URI', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 's3://another-bucket/test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns an error when SNS topic env is missing', async () => {
    delete process.env.SNS_FOLDER_DOWNLOAD_TOPIC;
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockPutObject.mockResolvedValue({});

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).not.toBe(200);
    expect(mockPutObject).toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 403 for unauthorized users', async () => {
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid request body', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(createMockEvent({}), createMockContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 403 when requested prefix does not include request LaboratoryId segment', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'different-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 400 when folder content exceeds 3GB', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockListBucketObjectsV2
      .mockResolvedValueOnce({
        Contents: [],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/huge.bin', Size: 4 * 1024 * 1024 * 1024 }],
        IsTruncated: false,
      });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.Error).toContain('exceeds the 3GB download limit');
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('supports paginated size checks before creating job', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockPutObject.mockResolvedValue({});
    mockPublish.mockResolvedValue({});

    mockListBucketObjectsV2
      .mockResolvedValueOnce({
        Contents: [],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/a.bin', Size: 1024 }],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/b.bin', Size: 2048 }],
        IsTruncated: false,
      });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'test-bucket',
        S3Prefix: 'test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(3);
    expect(mockListBucketObjectsV2).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        ContinuationToken: 'page-2',
      }),
    );
  });
});
