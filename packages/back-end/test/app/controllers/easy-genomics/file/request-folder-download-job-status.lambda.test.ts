import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/file/request-folder-download-job-status.lambda';

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

describe('request-folder-download-job-status Lambda', () => {
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockGetPreSignedDownloadUrl: jest.Mock;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
  };

  const jobId = '61c86013-74f2-4d30-916a-70b03a97ba14';

  const createMockEvent = (body: any): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/file/request-folder-download-job-status',
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
    functionName: 'request-folder-download-job-status',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-folder-download-job-status',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-folder-download-job-status',
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
    mockGetObject = jest.fn();
    mockGetPreSignedDownloadUrl = jest.fn();
    mockS3ServiceInstance.prototype.getObject = mockGetObject;
    mockS3ServiceInstance.prototype.getPreSignedDownloadUrl = mockGetPreSignedDownloadUrl;
  });

  it('returns completed status with signed URL', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetObject.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            JobId: jobId,
            LaboratoryId: 'test-lab-id',
            Status: 'COMPLETED',
            RequestedPrefix: 'test-org-id/test-lab-id/results/',
            ArchiveS3Key: 'test-org-id/test-lab-id/.downloads/archives/zip.zip',
            CreatedAt: new Date().toISOString(),
          }),
      },
    });
    mockGetPreSignedDownloadUrl.mockResolvedValue('https://signed-url.example.com/folder.zip');

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        JobId: jobId,
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('COMPLETED');
    expect(body.DownloadUrl).toBe('https://signed-url.example.com/folder.zip');
    expect(mockGetPreSignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'test-org-id/test-lab-id/.downloads/archives/zip.zip',
        ResponseContentDisposition: 'attachment; filename="results.zip"',
      }),
    );
  });

  it('returns 403 for unauthorized requests', async () => {
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        JobId: jobId,
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('returns pending status without download URL', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetObject.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            JobId: jobId,
            LaboratoryId: 'test-lab-id',
            Status: 'PENDING',
            RequestedPrefix: 'test-org-id/test-lab-id/results/',
            ArchiveS3Key: 'test-org-id/test-lab-id/.downloads/archives/zip.zip',
            CreatedAt: new Date().toISOString(),
          }),
      },
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        JobId: jobId,
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('PENDING');
    expect(body.DownloadUrl).toBeUndefined();
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns failed status with error message', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockGetObject.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            JobId: jobId,
            LaboratoryId: 'test-lab-id',
            Status: 'FAILED',
            RequestedPrefix: 'test-org-id/test-lab-id/results/',
            ArchiveS3Key: 'test-org-id/test-lab-id/.downloads/archives/zip.zip',
            ErrorMessage: 'Something failed',
            CreatedAt: new Date().toISOString(),
          }),
      },
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        JobId: jobId,
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('FAILED');
    expect(body.ErrorMessage).toBe('Something failed');
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid request body', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'test-lab-id',
        JobId: 'not-a-uuid',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});
