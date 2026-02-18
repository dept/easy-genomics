import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-list-bucket-objects.lambda';

// Mock the services
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('request-list-bucket-objects Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockListBucketObjectsV2: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
    Name: 'Test Lab',
  };

  const mockS3Object1 = {
    Key: 'test-org-id/test-lab-id/sample1_R1.fastq.gz',
    Size: 1000,
    LastModified: '2025-02-18T10:00:00Z',
    ETag: '"abc123"',
    StorageClass: 'STANDARD',
  };

  const mockS3Object2 = {
    Key: 'test-org-id/test-lab-id/sample1_R2.fastq.gz',
    Size: 1000,
    LastModified: '2025-02-18T10:00:00Z',
    ETag: '"def456"',
    StorageClass: 'STANDARD',
  };

  const createMockEvent = (body: any): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-list-bucket-objects',
    headers: {},
    requestContext: {
      authorizer: {
        claims: {
          email: 'test@example.com',
        },
      },
    } as any,
    resource: '',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
  });

  const createMockContext = (): Context => ({
    functionName: 'request-list-bucket-objects',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-list-bucket-objects',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-list-bucket-objects',
    logStreamName: '2025/02/18/[$LATEST]test',
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

    // Setup default return values
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    // Setup service mocks
    const mockLaboratoryServiceInstance = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockQueryByLaboratoryId = jest.fn();
    mockLaboratoryServiceInstance.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBucketObjectsV2 = jest.fn();
    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
  });

  describe('Single Page Results (< 1000 objects)', () => {
    it('should return all S3 objects when less than 1000 objects and no pagination needed', async () => {
      // Mock authorization
      mockValidateOrgAdmin.mockReturnValue(true);

      // Mock laboratory service
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      // Mock S3 service - single page response
      const mockListResponse = {
        Contents: [mockS3Object1, mockS3Object2],
        IsTruncated: false,
        NextContinuationToken: undefined,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.Contents).toHaveLength(2);
      expect(body.Contents[0].Key).toBe('test-org-id/test-lab-id/sample1_R1.fastq.gz');
      expect(body.Contents[1].Key).toBe('test-org-id/test-lab-id/sample1_R2.fastq.gz');
      expect(body.IsTruncated).toBe(false);
    });

    it('should handle empty bucket/prefix', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);

      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const mockListResponse = {
        Contents: [],
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.Contents).toEqual([]);
    });
  });

  describe('Multiple Page Results (> 1000 objects)', () => {
    it('should paginate and return all objects across multiple pages', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);

      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      // Create mock responses for two pages
      const page1Contents = Array.from({ length: 1000 }, (_, i) => ({
        Key: `test-org-id/test-lab-id/sample${i}_R1.fastq.gz`,
        Size: 1000,
        LastModified: '2025-02-18T10:00:00Z',
        ETag: `"etag${i}"`,
        StorageClass: 'STANDARD',
      }));

      const page2Contents = Array.from({ length: 500 }, (_, i) => ({
        Key: `test-org-id/test-lab-id/sample${1000 + i}_R1.fastq.gz`,
        Size: 1000,
        LastModified: '2025-02-18T10:00:00Z',
        ETag: `"etag${1000 + i}"`,
        StorageClass: 'STANDARD',
      }));

      const mockListResponse1 = {
        Contents: page1Contents,
        IsTruncated: true,
        NextContinuationToken: 'continuation-token-123',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id-1',
          extendedRequestId: 'test-extended-id-1',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      const mockListResponse2 = {
        Contents: page2Contents,
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id-2',
          extendedRequestId: 'test-extended-id-2',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValueOnce(mockListResponse1).mockResolvedValueOnce(mockListResponse2);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.Contents).toHaveLength(1500);
      expect(body.Contents[0].Key).toBe('test-org-id/test-lab-id/sample0_R1.fastq.gz');
      expect(body.Contents[1499].Key).toBe('test-org-id/test-lab-id/sample1499_R1.fastq.gz');
      expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(2);
      expect(mockListBucketObjectsV2).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          ContinuationToken: 'continuation-token-123',
        }),
      );
    });

    it('should handle multiple continuation tokens correctly', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);

      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      // Create three pages
      const mockListResponse1 = {
        Contents: Array.from({ length: 1000 }, (_, i) => ({
          Key: `test-org-id/test-lab-id/sample${i}_R1.fastq.gz`,
          Size: 1000,
          LastModified: '2025-02-18T10:00:00Z',
          ETag: `"etag${i}"`,
          StorageClass: 'STANDARD',
        })),
        IsTruncated: true,
        NextContinuationToken: 'token-1',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'req-1',
          extendedRequestId: 'ext-1',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      const mockListResponse2 = {
        Contents: Array.from({ length: 1000 }, (_, i) => ({
          Key: `test-org-id/test-lab-id/sample${1000 + i}_R1.fastq.gz`,
          Size: 1000,
          LastModified: '2025-02-18T10:00:00Z',
          ETag: `"etag${1000 + i}"`,
          StorageClass: 'STANDARD',
        })),
        IsTruncated: true,
        NextContinuationToken: 'token-2',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'req-2',
          extendedRequestId: 'ext-2',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      const mockListResponse3 = {
        Contents: Array.from({ length: 500 }, (_, i) => ({
          Key: `test-org-id/test-lab-id/sample${2000 + i}_R1.fastq.gz`,
          Size: 1000,
          LastModified: '2025-02-18T10:00:00Z',
          ETag: `"etag${2000 + i}"`,
          StorageClass: 'STANDARD',
        })),
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'req-3',
          extendedRequestId: 'ext-3',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2
        .mockResolvedValueOnce(mockListResponse1)
        .mockResolvedValueOnce(mockListResponse2)
        .mockResolvedValueOnce(mockListResponse3);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.Contents).toHaveLength(2500);
      expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(3);
    });
  });

  describe('Authorization', () => {
    it('should allow Organization Admin access', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const mockListResponse = {
        Contents: [mockS3Object1],
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
    });

    it('should allow Laboratory Manager access', async () => {
      mockValidateOrgAdmin.mockReturnValue(false);
      mockValidateLabManager.mockReturnValue(true);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const mockListResponse = {
        Contents: [mockS3Object1],
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
    });

    it('should deny unauthorized access', async () => {
      mockValidateOrgAdmin.mockReturnValue(false);
      mockValidateLabManager.mockReturnValue(false);
      mockValidateLabTechnician.mockReturnValue(false);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(403);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid request body', async () => {
      const event = createMockEvent({
        // Missing required LaboratoryId
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(400);
    });

    it('should use custom S3 bucket if provided', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const mockListResponse = {
        Contents: [mockS3Object1],
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
        S3Bucket: 'custom-bucket',
        S3Prefix: 'custom-prefix/',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'custom-bucket',
          Prefix: 'custom-prefix/',
        }),
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined Contents gracefully', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      // Response with undefined Contents
      const mockListResponse = {
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'test-request-id',
          extendedRequestId: 'test-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValue(mockListResponse);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.Contents).toEqual([]);
    });

    it('should preserve metadata from first response in merged response', async () => {
      mockValidateOrgAdmin.mockReturnValue(true);
      mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

      const mockListResponse1 = {
        Contents: Array.from({ length: 1000 }, (_, i) => ({
          Key: `test-org-id/test-lab-id/sample${i}_R1.fastq.gz`,
          Size: 1000,
          LastModified: '2025-02-18T10:00:00Z',
          ETag: `"etag${i}"`,
          StorageClass: 'STANDARD',
        })),
        IsTruncated: true,
        NextContinuationToken: 'token-1',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'original-request-id',
          extendedRequestId: 'original-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      const mockListResponse2 = {
        Contents: [mockS3Object1],
        IsTruncated: false,
        $metadata: {
          httpStatusCode: 200,
          requestId: 'second-request-id',
          extendedRequestId: 'second-extended-id',
          attempts: 1,
          totalRetryDelay: 0,
        },
      };

      mockListBucketObjectsV2.mockResolvedValueOnce(mockListResponse1).mockResolvedValueOnce(mockListResponse2);

      const event = createMockEvent({
        LaboratoryId: 'test-lab-id',
      });
      const context = createMockContext();

      const result = await handler(event, context, () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.$metadata.requestId).toBe('original-request-id');
      expect(body.$metadata.extendedRequestId).toBe('original-extended-id');
    });
  });
});
