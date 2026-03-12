import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-search-bucket-objects.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('request-search-bucket-objects Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockListBucketObjectsV2: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
  };

  const createMockEvent = (body: any): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-search-bucket-objects',
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
    functionName: 'request-search-bucket-objects',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-search-bucket-objects',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-search-bucket-objects',
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
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const mockLaboratoryServiceInstance = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockQueryByLaboratoryId = jest.fn();
    mockLaboratoryServiceInstance.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBucketObjectsV2 = jest.fn();
    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
  });

  it('returns matching objects from nested directories', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [
        {
          Key: 'test-org-id/test-lab-id/results/workflow/report.html',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
        {
          Key: 'test-org-id/test-lab-id/results/workflow/log.txt',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
        {
          Key: 'test-org-id/test-lab-id/input/read1.fastq.gz',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
      ],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({ LaboratoryId: 'test-lab-id', SearchQuery: 'workflow', S3Prefix: 'test-org-id/test-lab-id/' }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Contents).toHaveLength(2);
    expect(body.Contents.every((item: any) => item.Key.includes('workflow'))).toBe(true);
    expect(body.CommonPrefixes).toEqual(
      expect.arrayContaining([{ Prefix: 'test-org-id/test-lab-id/results/workflow/' }]),
    );
  });

  it('returns matching directory prefixes when query matches folder name', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [
        {
          Key: 'test-org-id/test-lab-id/pipeline_info/run.log',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
        {
          Key: 'test-org-id/test-lab-id/other/read1.fastq.gz',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
      ],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({ LaboratoryId: 'test-lab-id', SearchQuery: 'pipeline_info' }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.CommonPrefixes).toEqual(expect.arrayContaining([{ Prefix: 'test-org-id/test-lab-id/pipeline_info/' }]));
  });

  it('returns 403 when provided prefix is outside laboratory root', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        SearchQuery: 'workflow',
        S3Prefix: 'another-org/another-lab/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalled();
  });

  it('supports s3 uri in S3Prefix when it belongs to laboratory root', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);
    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [
        {
          Key: 'test-org-id/test-lab-id/results/workflow/report.html',
          Size: 10,
          LastModified: '2025-01-01',
          ETag: '',
          StorageClass: 'STANDARD',
        },
      ],
      IsTruncated: false,
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        SearchQuery: 'report',
        S3Prefix: 's3://test-bucket/test-org-id/test-lab-id/results/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Prefix: 'test-org-id/test-lab-id/results/',
      }),
    );
  });

  it('returns 403 for unauthorized users', async () => {
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({ LaboratoryId: 'test-lab-id', SearchQuery: 'workflow' }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
  });
});
