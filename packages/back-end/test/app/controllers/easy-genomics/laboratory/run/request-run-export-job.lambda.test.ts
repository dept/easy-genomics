import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-run-export-job.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/s3-service');
jest.mock('../../../../../../src/app/services/sqs-service');
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

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../../src/app/services/s3-service';
import { SqsService } from '../../../../../../src/app/services/sqs-service';
import { validateOrganizationAdminAccess } from '../../../../../../src/app/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '../../../../../../src/app/utils/laboratory-s3-access-utils';

describe('request-run-export-job Lambda', () => {
  let mockQueryByLaboratoryId: jest.Mock;
  let mockQueryByRunId: jest.Mock;
  let mockListAllObjectsUnderPrefix: jest.Mock;
  let mockPutObject: jest.Mock;
  let mockSendMessage: jest.Mock;

  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
  };

  const completedRun = {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    RunName: 'TB Panel',
    Status: 'COMPLETED',
    OutputS3Url: 's3://lab-bucket/org-1/lab-1/results/',
  };

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-run-export-job',
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
      functionName: 'request-run-export-job',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:request-run-export-job',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/request-run-export-job',
      logStreamName: 'test',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SQS_RUN_EXPORT_QUEUE_URL = 'https://sqs/export.fifo';
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);

    mockQueryByLaboratoryId = jest.fn().mockResolvedValue(laboratory);
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId =
      mockQueryByLaboratoryId;

    mockQueryByRunId = jest.fn().mockResolvedValue(completedRun);
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByRunId = mockQueryByRunId;

    mockListAllObjectsUnderPrefix = jest.fn().mockResolvedValue([{ Key: 'org-1/lab-1/results/a.vcf', Size: 100 }]);
    mockPutObject = jest.fn().mockResolvedValue({});
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectsUnderPrefix =
      mockListAllObjectsUnderPrefix;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.putObject = mockPutObject;

    mockSendMessage = jest.fn().mockResolvedValue({});
    (SqsService as jest.MockedClass<typeof SqsService>).prototype.sendMessage = mockSendMessage;
  });

  it('enqueues a download job for selected completed runs under the ZIP size limit', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ Status: 'PENDING', Destination: 'Download' });
    const message = JSON.parse(mockSendMessage.mock.calls[0][0].MessageBody);
    expect(message.Sources).toEqual([
      {
        RunId: 'run-1',
        RunName: 'TB Panel',
        SourceBucket: 'lab-bucket',
        SourcePrefix: 'org-1/lab-1/results/',
      },
    ]);
    const pendingStatus = JSON.parse(mockPutObject.mock.calls[0][0].Body);
    expect(pendingStatus.RunIds).toEqual(['run-1']);
    expect(pendingStatus.RunName).toBe('TB Panel');
  });

  it('namespaces a single-run S3 copy under the lab exports root', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'S3',
        DestinationBucket: 'lims-bucket',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const message = JSON.parse(mockSendMessage.mock.calls[0][0].MessageBody);
    expect(message.DestPrefix).toBe('org-1/lab-1/exports/');
  });

  it('returns 403 when the caller has no laboratory access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects a run whose output prefix is outside the laboratory path', async () => {
    mockQueryByRunId.mockResolvedValue({
      ...completedRun,
      OutputS3Url: 's3://lab-bucket/other-org/other-lab/secrets/',
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects S3 export without a destination bucket', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'S3',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects more than 25 run ids', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: Array.from({ length: 26 }, (_, index) => `run-${index}`),
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('enqueues an S3 copy job for multiple runs with a bundle prefix', async () => {
    mockQueryByRunId.mockResolvedValueOnce(completedRun).mockResolvedValueOnce({
      ...completedRun,
      RunId: 'run-2',
      RunName: 'Flu Panel',
      OutputS3Url: 's3://lab-bucket/org-1/lab-1/flu/',
    });
    mockListAllObjectsUnderPrefix
      .mockResolvedValueOnce([{ Key: 'org-1/lab-1/results/a.vcf', Size: 100 }])
      .mockResolvedValueOnce([{ Key: 'org-1/lab-1/flu/b.vcf', Size: 50 }]);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1', 'run-2'],
        Destination: 'S3',
        DestinationBucket: 'lims-bucket',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const message = JSON.parse(mockSendMessage.mock.calls[0][0].MessageBody);
    expect(message.Sources).toHaveLength(2);
    expect(message.DestBucket).toBe('lims-bucket');
    expect(message.DestPrefix).toBe('org-1/lab-1/exports/bundle-2-runs/');
    expect(assertLaboratoryHasS3BucketAccess).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: 'lab-1' }),
      'lims-bucket',
      expect.anything(),
    );
  });

  it('rejects ZIP download when the selected runs are larger than 5GB', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue([
      { Key: 'org-1/lab-1/results/huge.bam', Size: 6 * 1024 * 1024 * 1024 },
    ]);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects S3 export that overlaps a run output prefix', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Lims',
        DestinationBucket: 'lab-bucket',
        DestinationPrefix: 'org-1/lab-1/results/copy/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects a request with no run ids', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: [],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects empty exportable output', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue([{ Key: 'org-1/lab-1/results/work/tmp.bin', Size: 50 }]);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects when the expanded object count exceeds the cap', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue(
      Array.from({ length: 10_001 }, (_, index) => ({
        Key: `org-1/lab-1/results/file-${index}.vcf`,
        Size: 1,
      })),
    );

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'S3',
        DestinationBucket: 'lims-bucket',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('nests a caller prefix under the laboratory path', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'S3',
        DestinationBucket: 'lims-bucket',
        DestinationPrefix: 'incoming/tb/',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const message = JSON.parse(mockSendMessage.mock.calls[0][0].MessageBody);
    expect(message.DestPrefix).toBe('org-1/lab-1/incoming/tb/');
  });

  it('rejects download when the laboratory has no S3 bucket', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...laboratory, S3Bucket: undefined });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
        Destination: 'Download',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
