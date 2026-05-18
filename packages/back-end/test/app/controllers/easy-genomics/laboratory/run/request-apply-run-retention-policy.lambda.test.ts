process.env.NAME_PREFIX = 'unit-test';

import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(() => true),
  validateLaboratoryManagerAccess: jest.fn(() => false),
  validateLaboratoryTechnicianAccess: jest.fn(() => false),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-apply-run-retention-policy.lambda';
import { LaboratoryDataTaggingService } from '../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';

describe('request-apply-run-retention-policy.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const inputKey = `${ORG_ID}/${LAB_ID}/sample.fq.gz`;

  let mockQueryRuns: jest.Mock;
  let mockUpdateRetention: jest.Mock;
  let mockQueryLab: jest.Mock;
  let propagateSpy: jest.SpyInstance;

  const createEvent = (body: object, query: Record<string, string> = { laboratoryId: LAB_ID }) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-apply-run-retention-policy',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
            'cognito:username': 'user-1',
          },
        },
      },
      resource: '',
      queryStringParameters: query,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createContext = (): Context =>
    ({
      functionName: 'request-apply-run-retention-policy',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:request-apply-run-retention-policy',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/request-apply-run-retention-policy',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryRuns = jest.fn();
    mockUpdateRetention = jest.fn().mockResolvedValue({});
    mockQueryLab = jest.fn();

    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByLaboratoryId =
      mockQueryRuns;
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.updateRetentionMetadata =
      mockUpdateRetention;
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = mockQueryLab;

    mockQueryLab.mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: ORG_ID,
      RunRetentionMonths: 6,
      S3Bucket: 'lab-bucket',
    });

    propagateSpy = jest
      .spyOn(LaboratoryDataTaggingService.prototype, 'updateRunUsageExpiresAt')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    propagateSpy.mockRestore();
  });

  it('does not call updateRunUsageExpiresAt on a dry run even when runs would be updated', async () => {
    mockQueryRuns.mockResolvedValue([
      {
        RunId: 'run-1',
        LaboratoryId: LAB_ID,
        OrganizationId: ORG_ID,
        Status: 'COMPLETED',
        TerminalAt: null,
        ExpiresAt: null,
        CreatedAt: '2024-01-01T00:00:00.000Z',
        InputFileKeys: [inputKey],
      },
    ]);

    const result = await handler(createEvent({ retentionMonths: 6, dryRun: true }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockUpdateRetention).not.toHaveBeenCalled();
    expect(propagateSpy).not.toHaveBeenCalled();
  });
});
