import { RunCostLimitExceededError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockQueryByLaboratoryId = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: (...args: unknown[]) => mockQueryByLaboratoryId(...args),
  })),
}));
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service');
jest.mock('../../../../../src/app/utils/laboratory-workflow-access-utils', () => ({
  assertLaboratoryHasWorkflowAccess: jest.fn(),
}));
const mockGetParameter = jest.fn();
jest.mock('../../../../../src/app/services/ssm-service', () => ({
  SsmService: jest.fn().mockImplementation(() => ({
    getParameter: (...args: unknown[]) => mockGetParameter(...args),
  })),
}));
jest.mock('../../../../../src/app/utils/rest-api-utils', () => ({
  ...jest.requireActual('../../../../../src/app/utils/rest-api-utils'),
  httpRequest: jest.fn(),
  getNextFlowApiQueryParameters: jest.fn(() => 'workspaceId=ws-1'),
}));
jest.mock('../../../../../src/app/utils/auth-utils');
const mockAssertLaunchWithinLimits = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/run-limit-check-service', () => ({
  RunLimitCheckService: jest.fn().mockImplementation(() => ({
    assertLaunchWithinLimits: (...args: unknown[]) => mockAssertLaunchWithinLimits(...args),
  })),
}));

import { handler } from '../../../../../src/app/controllers/nf-tower/workflow/create-workflow-execution.lambda';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';
import { assertLaboratoryHasWorkflowAccess } from '../../../../../src/app/utils/laboratory-workflow-access-utils';
import { httpRequest } from '../../../../../src/app/utils/rest-api-utils';

describe('create-workflow-execution.lambda', () => {
  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
    NextFlowTowerEnabled: true,
    NextFlowTowerApiBaseUrl: 'https://seqera.example.com/api',
    RunLimits: { CostBlockAboveUsd: 400 },
  };
  const paramsText = '{"input":"s3://lab-bucket/run/samplesheet.csv","outdir":"s3://lab-bucket/out"}';

  const createEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      queryStringParameters: { laboratoryId: 'lab-1', pipelineId: 'pipe-1' },
      requestContext: {
        authorizer: { claims: { 'UserId': 'user-1', 'cognito:username': 'cognito-user' } },
      },
    }) as any;
  const context = {} as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockQueryByLaboratoryId.mockResolvedValue(laboratory);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);
    (assertLaboratoryHasWorkflowAccess as jest.Mock).mockResolvedValue(undefined);
    mockGetParameter.mockResolvedValue({ Parameter: { Value: 'token' } });
    (httpRequest as jest.Mock).mockResolvedValue({ workflowId: 'seqera-run-1' });
    mockAssertLaunchWithinLimits.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks the run from the launch paramsText, matching the review step request', async () => {
    await handler(createEvent({ launch: { paramsText } }), context, () => {});

    expect(mockAssertLaunchWithinLimits).toHaveBeenCalledWith(
      laboratory,
      {
        platform: 'Seqera Cloud',
        workflowExternalId: 'pipe-1',
        sampleSheetS3Url: 's3://lab-bucket/run/samplesheet.csv',
        settings: { input: 's3://lab-bucket/run/samplesheet.csv', outdir: 's3://lab-bucket/out' },
      },
      'user-1',
    );
    expect(mockAssertLaunchWithinLimits.mock.calls[0][1]).not.toHaveProperty('workflowVersionName');
  });

  it('refuses a run over the cost block amount before reading the token or calling Seqera', async () => {
    mockAssertLaunchWithinLimits.mockRejectedValue(new RunCostLimitExceededError(470, 400));

    const result = await handler(createEvent({ launch: { paramsText } }), context, () => {});

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-339');
    expect(mockGetParameter).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('checks a launch whose paramsText is not JSON with no settings or sample sheet', async () => {
    const result = await handler(createEvent({ launch: { paramsText: 'not json' } }), context, () => {});

    expect(mockAssertLaunchWithinLimits).toHaveBeenCalledWith(
      laboratory,
      { platform: 'Seqera Cloud', workflowExternalId: 'pipe-1', sampleSheetS3Url: undefined, settings: undefined },
      'user-1',
    );
    expect(result.statusCode).toBe(200);
  });

  it('forwards the original launch body to Seqera when the check passes', async () => {
    const body = { launch: { paramsText, pipeline: 'https://github.com/nf-core/rnaseq' } };

    const result = await handler(createEvent(body), context, () => {});

    expect(result.statusCode).toBe(200);
    expect((httpRequest as jest.Mock).mock.calls[0][3]).toEqual(body);
  });
});
