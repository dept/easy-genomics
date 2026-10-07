import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/request-preview-workflow-key-outputs.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../src/app/utils/laboratory-s3-access-utils', () => ({
  assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue(undefined),
}));

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const RUN_ID = '3f7c1c9e-2222-4222-8222-222222222222';
const ROOT = 'org/lab/aws-healthomics/run-1/results/1234567/';

describe('request-preview-workflow-key-outputs Lambda', () => {
  let mockListAllObjectKeysUnderPrefix: jest.Mock;

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/workflow-key-outputs/request-preview-workflow-key-outputs',
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
      functionName: 'request-preview-workflow-key-outputs',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-preview-workflow-key-outputs',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/request-preview-workflow-key-outputs',
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
        RunId: RUN_ID,
        Platform: 'AWS HealthOmics',
        ExternalRunId: '1234567',
        OutputS3Url: 's3://lab-bucket/org/lab/aws-healthomics/run-1/results',
      });

    mockListAllObjectKeysUnderPrefix = jest.fn().mockResolvedValue(
      Array.from({ length: 48 }, (_unused, index) => {
        const sample = `sample${String(index + 1).padStart(2, '0')}`;
        return `${ROOT}variants/ivar/consensus/bcftools/${sample}.consensus.fa`;
      }).concat([`${ROOT}multiqc/multiqc_report.html`]),
    );
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectKeysUnderPrefix =
      mockListAllObjectKeysUnderPrefix;
  });

  it('infers *.consensus.fa from one ticked sample and reports the match count', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        RunId: RUN_ID,
        ObjectKeys: [`${ROOT}variants/ivar/consensus/bcftools/sample01.consensus.fa`],
      }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toHaveLength(1);
    expect(body.KeyOutputs[0].Pattern).toEqual('variants/ivar/consensus/bcftools/*.consensus.fa');
    expect(body.KeyOutputs[0].MatchCount).toEqual(48);
    expect(body.KeyOutputs[0].Label).toEqual('Consensus');
  });

  it('scores an existing JSON pattern against the run', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        RunId: RUN_ID,
        KeyOutputs: [{ Label: 'QC report', Pattern: 'multiqc/multiqc_report.html' }],
      }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs[0].MatchCount).toEqual(1);
  });
});
