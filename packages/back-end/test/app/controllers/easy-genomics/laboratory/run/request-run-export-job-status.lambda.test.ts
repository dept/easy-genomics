import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-run-export-job-status.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/s3-service');
jest.mock('../../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../../src/app/utils/laboratory-s3-access-utils', () => ({
  assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service', () => ({
  LaboratoryDataTaggingService: jest.fn().mockImplementation(() => ({
    assertKeyUnderLabPrefix: (laboratory: { OrganizationId: string; LaboratoryId: string }, key: string) => {
      const root = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
      if (!key.startsWith(root)) {
        throw new Error(`S3 key is outside the laboratory prefix: ${key}`);
      }
    },
  })),
}));

import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../../src/app/services/s3-service';
import { validateOrganizationAdminAccess } from '../../../../../../src/app/utils/auth-utils';

describe('request-run-export-job-status Lambda', () => {
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockDeleteObject: jest.Mock;
  let mockGetPreSignedDownloadUrl: jest.Mock;

  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
  };
  const jobId = '61c86013-74f2-4d30-916a-70b03a97ba14';

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-run-export-job-status',
      headers: {},
      requestContext: { authorizer: { claims: { email: 'test@example.com' } } } as any,
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createMockContext = (): Context =>
    ({
      functionName: 'request-run-export-job-status',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:request-run-export-job-status',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/request-run-export-job-status',
      logStreamName: 'test',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  const statusBody = (status: Record<string, unknown>) => ({
    Body: { transformToString: async () => JSON.stringify(status) },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);

    mockQueryByLaboratoryId = jest.fn().mockResolvedValue(laboratory);
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId =
      mockQueryByLaboratoryId;

    mockGetObject = jest.fn();
    mockDeleteObject = jest.fn().mockResolvedValue({});
    mockGetPreSignedDownloadUrl = jest.fn().mockResolvedValue('https://signed.example/bundle.zip');
    const mockS3 = S3Service as jest.MockedClass<typeof S3Service>;
    mockS3.prototype.getObject = mockGetObject;
    mockS3.prototype.deleteObject = mockDeleteObject;
    mockS3.prototype.getPreSignedDownloadUrl = mockGetPreSignedDownloadUrl;
  });

  it('returns a signed ZIP URL for a completed download job', async () => {
    mockGetObject.mockResolvedValue(
      statusBody({
        JobId: jobId,
        LaboratoryId: 'lab-1',
        Status: 'COMPLETED',
        Destination: 'Download',
        RunIds: ['run-1'],
        RunName: 'TB Panel',
        ArchiveS3Key: 'org-1/lab-1/.exports/archives/job.zip',
        CreatedAt: new Date().toISOString(),
      }),
    );

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      Status: 'COMPLETED',
      DownloadUrl: 'https://signed.example/bundle.zip',
    });
    expect(mockGetObject).toHaveBeenCalledWith({
      Bucket: 'lab-bucket',
      Key: `org-1/lab-1/.exports/jobs/${jobId}.json`,
    });
    expect(mockGetPreSignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'lab-bucket',
        Key: 'org-1/lab-1/.exports/archives/job.zip',
        ResponseContentDisposition: 'attachment; filename="TB_Panel-results.zip"',
      }),
    );
  });

  it('returns a destination URI for a completed S3 copy', async () => {
    mockGetObject.mockResolvedValue(
      statusBody({
        JobId: jobId,
        LaboratoryId: 'lab-1',
        Status: 'COMPLETED',
        Destination: 'S3',
        DestBucket: 'lims-bucket',
        DestPrefix: 'org-1/lab-1/exports/bundle-2-runs/',
        FilesCopied: 4,
        CreatedAt: new Date().toISOString(),
      }),
    );

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      DestinationS3Uri: 's3://lims-bucket/org-1/lab-1/exports/bundle-2-runs/',
      FilesCopied: 4,
    });
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('deletes expired status and archive objects', async () => {
    mockGetObject.mockResolvedValue(
      statusBody({
        JobId: jobId,
        LaboratoryId: 'lab-1',
        Status: 'COMPLETED',
        Destination: 'Download',
        ArchiveS3Key: 'org-1/lab-1/.exports/archives/job.zip',
        CreatedAt: new Date().toISOString(),
        ExpiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockDeleteObject).toHaveBeenCalledWith({
      Bucket: 'lab-bucket',
      Key: 'org-1/lab-1/.exports/archives/job.zip',
    });
    expect(mockDeleteObject).toHaveBeenCalledWith({
      Bucket: 'lab-bucket',
      Key: `org-1/lab-1/.exports/jobs/${jobId}.json`,
    });
  });

  it('rejects when the laboratory has no S3 bucket', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...laboratory, S3Bucket: undefined });

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid job id', async () => {
    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: 'not-a-uuid' }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no laboratory access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('rejects an empty status object body', async () => {
    mockGetObject.mockResolvedValue({ Body: undefined });

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockGetPreSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('rejects a completed S3 destination outside the laboratory prefix', async () => {
    mockGetObject.mockResolvedValue(
      statusBody({
        JobId: jobId,
        LaboratoryId: 'lab-1',
        Status: 'COMPLETED',
        Destination: 'S3',
        DestBucket: 'lims-bucket',
        DestPrefix: 'other-org/other-lab/exports/',
        CreatedAt: new Date().toISOString(),
      }),
    );

    const result = await handler(
      createMockEvent({ LaboratoryId: 'lab-1', JobId: jobId }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).not.toBe(200);
    expect(JSON.parse(result.body).DestinationS3Uri).toBeUndefined();
  });
});
