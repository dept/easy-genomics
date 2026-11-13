import { RunSamplesNotCountedError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockEstimate = jest.fn();
const mockCheckRunLimits = jest.fn();
const mockQueryByLaboratoryId = jest.fn();
const mockValidateOrgAdmin = jest.fn();
const mockValidateLabManager = jest.fn();
const mockValidateLabTechnician = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: (...args: unknown[]) => mockQueryByLaboratoryId(...args),
  })),
}));
jest.mock('../../../../../../src/app/services/easy-genomics/run-cost-estimation-service', () => ({
  RunCostEstimationService: jest.fn().mockImplementation(() => ({
    estimate: (...args: unknown[]) => mockEstimate(...args),
  })),
}));
jest.mock('../../../../../../src/app/services/easy-genomics/run-limit-check-service', () => ({
  RunLimitCheckService: jest.fn().mockImplementation(() => ({
    checkRunLimits: (...args: unknown[]) => mockCheckRunLimits(...args),
  })),
}));
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: (...args: unknown[]) => mockValidateOrgAdmin(...args),
  validateLaboratoryManagerAccess: (...args: unknown[]) => mockValidateLabManager(...args),
  validateLaboratoryTechnicianAccess: (...args: unknown[]) => mockValidateLabTechnician(...args),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-estimate-run-cost.lambda';

describe('request-estimate-run-cost.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  const createEvent = (
    body: unknown,
    laboratoryId: string | undefined = LAB_ID,
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-estimate-run-cost',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'user@example.com',
            'cognito:username': 'user-1',
          },
        },
      },
      resource: '',
      queryStringParameters: laboratoryId ? { laboratoryId } : null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'request-estimate-run-cost',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:request-estimate-run-cost',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/request-estimate-run-cost',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  const validBody = {
    platform: 'Seqera Cloud',
    workflowExternalId: 'wf-1',
    sampleCount: 2,
    inputBytesTotal: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockEstimate.mockResolvedValue({
      estimateAvailable: true,
      confidence: 'MEDIUM',
      comparableRunCount: 5,
      computeCostUsd: { low: 1, median: 2, high: 3 },
      currency: 'USD',
      label: 'Estimated compute cost',
      disclaimer: 'disclaimer',
      exclusions: ['S3'],
    });
    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
    mockCheckRunLimits.mockReset().mockResolvedValue(undefined);
  });

  it('returns 404 when laboratoryId is missing', async () => {
    const result = await handler(createEvent(validBody, undefined), createContext(), () => {});
    expect(result.statusCode).toBe(404);
  });

  it('returns 400 for invalid request body', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: 'org-1',
    });
    const result = await handler(createEvent({ platform: 'Seqera Cloud' }), createContext(), () => {});
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when laboratory is not found', async () => {
    mockQueryByLaboratoryId.mockResolvedValue(undefined);
    const result = await handler(createEvent(validBody), createContext(), () => {});
    expect(result.statusCode).toBe(404);
  });

  it('returns 403 when user lacks access', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: 'org-1',
    });
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(validBody), createContext(), () => {});
    expect(result.statusCode).toBe(403);
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(mockCheckRunLimits).not.toHaveBeenCalled();
  });

  it('returns estimate on happy path', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      LaboratoryId: LAB_ID,
      OrganizationId: 'org-1',
    });

    const result = await handler(createEvent(validBody), createContext(), () => {});
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.estimateAvailable).toBe(true);
    expect(body.computeCostUsd.median).toBe(2);
    expect(mockEstimate).toHaveBeenCalled();
  });

  describe('run limit verdict', () => {
    const laboratory = { LaboratoryId: LAB_ID, OrganizationId: 'org-1', RunLimits: { CostWarnAboveUsd: 150 } };
    const reviewRequest = {
      platform: 'AWS HealthOmics',
      workflowExternalId: 'wf-1',
      workflowVersionName: 'v2',
      sampleSheetS3Url: 's3://lab-bucket/run/samplesheet.csv',
      settings: { input: 's3://lab-bucket/run/samplesheet.csv' },
    };

    beforeEach(() => {
      mockQueryByLaboratoryId.mockResolvedValue(laboratory);
    });

    it('returns exactly the estimate when the lab has no limits', async () => {
      const result = await handler(createEvent(reviewRequest), createContext(), () => {});

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toEqual(await mockEstimate.mock.results[0].value);
      expect(body).not.toHaveProperty('limitVerdict');
    });

    it('adds the verdict to the estimate', async () => {
      const verdict = {
        outcome: 'warn',
        hits: [{ limit: 'cost', level: 'warn', amount: 150, runValue: 182.5 }],
        costEstimate: 'available',
        sampleCount: 96,
      };
      mockCheckRunLimits.mockResolvedValue(verdict);

      const result = await handler(createEvent(reviewRequest), createContext(), () => {});

      const body = JSON.parse(result.body);
      expect(body.computeCostUsd.median).toBe(2);
      expect(body.limitVerdict).toEqual(verdict);
    });

    it('checks the run from server-derivable fields only, ignoring client-sent sizes', async () => {
      await handler(
        createEvent({ ...reviewRequest, sampleCount: 1, inputBytesTotal: 1, inputFileKeys: ['x'] }),
        createContext(),
        () => {},
      );

      expect(mockCheckRunLimits).toHaveBeenCalledWith(laboratory, reviewRequest);
    });

    it('returns the samples-not-counted error when the check cannot count the samples', async () => {
      mockCheckRunLimits.mockRejectedValue(new RunSamplesNotCountedError());

      const result = await handler(createEvent(reviewRequest), createContext(), () => {});

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).ErrorCode).toBe('EG-341');
    });
  });
});
