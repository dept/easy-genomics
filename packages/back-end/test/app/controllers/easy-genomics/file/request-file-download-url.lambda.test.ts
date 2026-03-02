import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-file-download-url.lambda';

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

describe('request-file-download-url Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetBucketLocation: jest.Mock;
  let mockGetPreSignedDownloadUrl: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r',
    Name: 'Test Lab',
  };

  const createMockEvent = (
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-file-download-url',
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
    ...overrides,
  });

  const createMockContext = (): Context => ({
    functionName: 'request-file-download-url',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-file-download-url',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-file-download-url',
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
    mockGetBucketLocation = jest.fn();
    mockGetPreSignedDownloadUrl = jest.fn();
    mockS3ServiceInstance.prototype.getBucketLocation = mockGetBucketLocation;
    mockS3ServiceInstance.prototype.getPreSignedDownloadUrl = mockGetPreSignedDownloadUrl;

    process.env.REGION = 'us-east-1';
  });

  it('should return 200 and a download URL when S3 key contains the laboratoryId', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetBucketLocation.mockResolvedValue({
      LocationConstraint: null,
    });

    mockGetPreSignedDownloadUrl.mockResolvedValue('https://signed-url.example.com/download');

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/test-lab-id/some-folder/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.DownloadUrl).toBe('https://signed-url.example.com/download');
    expect(mockGetPreSignedDownloadUrl).toHaveBeenCalledWith({
      Bucket: mockLaboratory.S3Bucket,
      Key: expect.stringContaining('test-lab-id'),
    });
  });

  it('should return 403 when S3 key does not contain the laboratoryId as a path segment', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetBucketLocation.mockResolvedValue({
      LocationConstraint: null,
    });

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/another-lab-id/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.Error).toBeTruthy();
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return 403 when user is not authorized even if S3 key contains the laboratoryId', async () => {
    // All validation mocks are false by default (no roles)
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/test-lab-id/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(403);
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should reject invalid request body', async () => {
    const event = createMockEvent({
      // Missing required LaboratoryId and S3Uri
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(400);
    expect(mockQueryByLaboratoryId).not.toHaveBeenCalled();
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return 400 when S3 bucket region does not match deployment region', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    process.env.REGION = 'us-east-1';
    mockGetBucketLocation.mockResolvedValue({
      LocationConstraint: 'eu-west-1',
    });

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/test-lab-id/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.Error).toContain('file download belongs in a different AWS Region');
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should allow Laboratory Manager access', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetBucketLocation.mockResolvedValue({
      LocationConstraint: null,
    });

    mockGetPreSignedDownloadUrl.mockResolvedValue('https://signed-url.example.com/download');

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/test-lab-id/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.DownloadUrl).toBe('https://signed-url.example.com/download');
  });

  it('should allow Laboratory Technician access', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetBucketLocation.mockResolvedValue({
      LocationConstraint: null,
    });

    mockGetPreSignedDownloadUrl.mockResolvedValue('https://signed-url.example.com/download');

    const s3Uri =
      's3://dev-demo-main-back-end-st-devdemodataprovisionings-irwxbkv1fp0r/61c86013-74f2-4d30-916a-70b03a97ba14/test-lab-id/apparel.csv';

    const event = createMockEvent({
      LaboratoryId: 'test-lab-id',
      S3Uri: s3Uri,
    });
    const context = createMockContext();

    const result = await handler(event, context, () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.DownloadUrl).toBe('https://signed-url.example.com/download');
  });
});
