import { S3BucketAccessDeniedError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/request-run-workflow-key-outputs.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../src/app/services/easy-genomics/workflow-key-outputs-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../src/app/utils/laboratory-s3-access-utils', () => ({
  assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue(undefined),
}));

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '../../../../../src/app/services/easy-genomics/workflow-key-outputs-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '../../../../../src/app/utils/laboratory-s3-access-utils';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const RUN_ID = '3f7c1c9e-2222-4222-8222-222222222222';
const ROOT = `org-1/${LAB_ID}/aws-healthomics/run-1/results/1234567/`;

describe('request-run-workflow-key-outputs Lambda', () => {
  let mockListAllObjectsUnderPrefix: jest.Mock;
  let mockGetDefinition: jest.Mock;

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/workflow-key-outputs/request-run-workflow-key-outputs',
      headers: {},
      requestContext: {
        requestId: 'request-id',
        authorizer: { claims: { 'cognito:username': 'user-1', 'email': 'test@example.com' } },
      } as any,
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createMockContext = (): Context =>
    ({
      functionName: 'request-run-workflow-key-outputs',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-run-workflow-key-outputs',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/request-run-workflow-key-outputs',
      logStreamName: '2026/10/06/[$LATEST]test',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({ OrganizationId: 'org-1', LaboratoryId: LAB_ID });

    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.get = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: LAB_ID,
        OrganizationId: 'org-1',
        RunId: RUN_ID,
        Platform: 'AWS HealthOmics',
        ExternalRunId: '1234567',
        WorkflowExternalId: 'wf-viralrecon',
        OutputS3Url: `s3://lab-bucket/org-1/${LAB_ID}/aws-healthomics/run-1/results`,
      });

    mockGetDefinition = jest.fn().mockResolvedValue(undefined);
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = mockGetDefinition;

    mockListAllObjectsUnderPrefix = jest.fn().mockResolvedValue(
      Array.from({ length: 48 }, (_unused, index) => {
        const sample = `sample${String(index + 1).padStart(2, '0')}`;
        return {
          Key: `${ROOT}variants/ivar/consensus/bcftools/${sample}.consensus.fa`,
          Size: 30000,
        };
      }).concat([
        { Key: `${ROOT}pangolin/sample01.pangolin.csv`, Size: 2000 },
        { Key: `${ROOT}multiqc/multiqc_report.html`, Size: 3200000 },
      ]),
    );
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectsUnderPrefix =
      mockListAllObjectsUnderPrefix;
  });

  it('returns grouped file examples when nothing has been declared yet', async () => {
    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toEqual([]);
    expect(body.MatchedFileCount).toEqual(0);
    expect(body.TotalFileCount).toEqual(50);
    expect(body.Groups.length).toBeGreaterThan(0);
    expect(body.Groups.some((group: { Pattern: string }) => group.Pattern.endsWith('*.consensus.fa'))).toBe(true);
  });

  it('groups matching files by role and reports unique counts and sizes', async () => {
    mockGetDefinition.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: 'wf-viralrecon',
      KeyOutputs: [
        {
          KeyOutputId: '11111111-1111-4111-8111-111111111111',
          Label: 'Consensus genome',
          Pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa',
        },
        {
          KeyOutputId: '22222222-2222-4222-8222-222222222222',
          Label: 'QC report',
          Pattern: 'multiqc/multiqc_report.html',
        },
      ],
    });

    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.TotalFileCount).toEqual(50);
    expect(body.MatchedFileCount).toEqual(49);
    expect(body.KeyOutputs).toHaveLength(2);
    expect(body.KeyOutputs[0].MatchCount).toEqual(48);
    expect(body.KeyOutputs[0].Matches).toHaveLength(48);
    expect(body.KeyOutputs[0].Matches[0].RelativePath).toEqual(
      'variants/ivar/consensus/bcftools/sample01.consensus.fa',
    );
    expect(body.KeyOutputs[1].MatchCount).toEqual(1);
    expect(body.KeyOutputs[1].MatchSizeBytes).toEqual(3200000);
    expect(body.Groups.some((group: { Pattern: string }) => group.Pattern.endsWith('*.consensus.fa'))).toBe(true);
    expect(assertLaboratoryHasS3BucketAccess).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: LAB_ID }),
      'lab-bucket',
      expect.anything(),
    );
  });

  it('caps Matches at 1000 while reporting the full MatchCount', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue(
      Array.from({ length: 1001 }, (_unused, index) => ({
        Key: `${ROOT}variants/ivar/consensus/bcftools/sample${String(index + 1).padStart(4, '0')}.consensus.fa`,
        Size: 100,
      })),
    );
    mockGetDefinition.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: 'wf-viralrecon',
      KeyOutputs: [
        {
          KeyOutputId: '11111111-1111-4111-8111-111111111111',
          Label: 'Consensus genome',
          Pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa',
        },
      ],
    });

    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs[0].MatchCount).toEqual(1001);
    expect(body.KeyOutputs[0].Matches).toHaveLength(1000);
  });

  it('rejects a run whose output prefix is outside this laboratory folder', async () => {
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.get = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: LAB_ID,
        OrganizationId: 'org-1',
        RunId: RUN_ID,
        Platform: 'AWS HealthOmics',
        ExternalRunId: '1234567',
        WorkflowExternalId: 'wf-viralrecon',
        OutputS3Url: 's3://lab-bucket/other-org/other-lab/secrets/',
      });

    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
  });

  it('does not list objects when the laboratory is not granted the bucket', async () => {
    (assertLaboratoryHasS3BucketAccess as jest.Mock).mockRejectedValueOnce(new S3BucketAccessDeniedError());

    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(403);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
  });

  it('rejects a caller with no laboratory access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(403);
    expect(mockListAllObjectsUnderPrefix).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const result = await handler(createMockEvent({ LaboratoryId: LAB_ID }), createMockContext(), () => {});
    expect(result.statusCode).toEqual(400);
  });
});
