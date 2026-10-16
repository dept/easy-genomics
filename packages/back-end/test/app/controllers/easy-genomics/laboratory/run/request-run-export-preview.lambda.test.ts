import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-run-export-preview.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
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

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('request-run-export-preview Lambda', () => {
  let mockQueryByLaboratoryId: jest.Mock;
  let mockQueryByRunId: jest.Mock;
  let mockListAllObjectsUnderPrefix: jest.Mock;

  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
  };

  const completedRun = {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    RunName: 'TB Panel',
    Status: 'SUCCEEDED',
    OutputS3Url: 's3://lab-bucket/org-1/lab-1/results/',
  };

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-run-export-preview',
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
      functionName: 'request-run-export-preview',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:request-run-export-preview',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/request-run-export-preview',
      logStreamName: 'test',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    mockQueryByLaboratoryId = jest.fn().mockResolvedValue(laboratory);
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId =
      mockQueryByLaboratoryId;

    mockQueryByRunId = jest.fn().mockResolvedValue(completedRun);
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByRunId = mockQueryByRunId;

    mockListAllObjectsUnderPrefix = jest.fn().mockResolvedValue([
      { Key: 'org-1/lab-1/results/report.html', Size: 100 },
      { Key: 'org-1/lab-1/results/work/tmp.bin', Size: 9_000_000_000 },
    ]);
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectsUnderPrefix =
      mockListAllObjectsUnderPrefix;
  });

  it('returns exportable size for selected runs and skips work/ files', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      RunCount: 1,
      FileCount: 1,
      TotalBytes: 100,
      CanDownloadAsZip: true,
    });
    expect(mockListAllObjectsUnderPrefix).toHaveBeenCalledWith('lab-bucket', 'org-1/lab-1/results/');
  });

  it('sets CanDownloadAsZip false when exportable output exceeds 5GB', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue([
      { Key: 'org-1/lab-1/results/huge.bam', Size: 6 * 1024 * 1024 * 1024 },
    ]);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      FileCount: 1,
      CanDownloadAsZip: false,
    });
  });

  it('returns 403 when the caller has no laboratory access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
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
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
  });

  it('rejects runs that are not complete', async () => {
    mockQueryByRunId.mockResolvedValue({ ...completedRun, Status: 'RUNNING' });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  it('rejects a run from another laboratory', async () => {
    mockQueryByRunId.mockResolvedValue({ ...completedRun, LaboratoryId: 'other-lab' });

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
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
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  it('allows a laboratory manager', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(validateLaboratoryManagerAccess).toHaveBeenCalledWith(expect.anything(), 'org-1', 'lab-1');
  });

  it('allows a laboratory technician', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(true);

    const result = await handler(
      createMockEvent({
        LaboratoryId: 'lab-1',
        RunIds: ['run-1'],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(validateLaboratoryTechnicianAccess).toHaveBeenCalledWith(expect.anything(), 'org-1', 'lab-1');
  });
});
