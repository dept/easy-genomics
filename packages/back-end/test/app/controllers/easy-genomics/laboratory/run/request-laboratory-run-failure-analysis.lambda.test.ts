import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/request-laboratory-run-failure-analysis.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/sqs-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { SqsService } from '../../../../../../src/app/services/sqs-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('request-laboratory-run-failure-analysis handler', () => {
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSqsService: jest.MockedClass<typeof SqsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockQueryByRunId: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockSendMessage: jest.Mock;

  const lab = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    HealthOmicsLlmProvider: 'bedrock',
    HealthOmicsLlmModelId: 'model-1',
  };

  const failedRun = {
    RunId: 'run-1',
    LaboratoryId: 'lab-1',
    Platform: 'AWS HealthOmics',
    Status: 'FAILED',
  };

  const buildEvent = (body: any, query: Record<string, string | undefined> = { laboratoryId: 'lab-1' }) =>
    ({
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/run/request-laboratory-run-failure-analysis',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'cognito:username': 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: query as any,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockSqsService = SqsService as jest.MockedClass<typeof SqsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockQueryByLaboratoryId = jest.fn().mockResolvedValue(lab);
    mockQueryByRunId = jest.fn().mockResolvedValue({ ...failedRun });
    mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockSendMessage = jest.fn().mockResolvedValue(undefined);

    mockLabService.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;
    mockRunService.prototype.queryByRunId = mockQueryByRunId;
    mockRunService.prototype.update = mockUpdate;
    mockSqsService.prototype.sendMessage = mockSendMessage;

    process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL = 'arn:aws:sns:us-east-1:123:classify.fifo';
  });

  it('returns 403 when the caller has no laboratory access', async () => {
    mockValidateLabTechnician.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    const response = await handler(buildEvent({ LaboratoryRunId: 'run-1' }), {} as any, () => undefined);
    expect(response.statusCode).toBe(403);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when the run is not FAILED', async () => {
    mockQueryByRunId.mockResolvedValue({ ...failedRun, Status: 'RUNNING' });
    const response = await handler(buildEvent({ LaboratoryRunId: 'run-1' }), {} as any, () => undefined);
    expect(response.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when the run belongs to a different laboratory', async () => {
    mockQueryByRunId.mockResolvedValue({ ...failedRun, LaboratoryId: 'some-other-lab' });
    const response = await handler(buildEvent({ LaboratoryRunId: 'run-1' }), {} as any, () => undefined);
    expect(response.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns EG-337 and enqueues nothing when the lab has no LLM provider configured', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...lab, HealthOmicsLlmProvider: undefined });
    const response = await handler(buildEvent({ LaboratoryRunId: 'run-1' }), {} as any, () => undefined);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).ErrorCode).toBe('EG-337');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('marks the run Queued and publishes with a Manual trigger', async () => {
    const response = await handler(buildEvent({ LaboratoryRunId: 'run-1' }), {} as any, () => undefined);
    expect(response.statusCode).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ AnalysisStatus: 'Queued', AnalysisErrorCode: undefined }),
    );
    const published = JSON.parse(mockSendMessage.mock.calls[0][0].MessageBody);
    expect(published.Trigger).toBe('Manual');
    expect(published.Type).toBe('LaboratoryRun');
    expect(published.Operation).toBe('UPDATE');
  });
});
