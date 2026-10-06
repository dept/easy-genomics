import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/list-workflow-key-outputs.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/workflow-key-outputs-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '../../../../../src/app/services/easy-genomics/workflow-key-outputs-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const WORKFLOW_ID = 'wf-viralrecon';

describe('list-workflow-key-outputs Lambda', () => {
  let mockGet: jest.Mock;
  let mockQueryByLaboratoryId: jest.Mock;

  const createMockEvent = (query: Record<string, string> | null): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/workflow-key-outputs/list-workflow-key-outputs',
      headers: {},
      requestContext: {
        requestId: 'request-id',
        authorizer: { claims: { 'cognito:username': 'user-1', 'email': 'test@example.com' } },
      } as any,
      resource: '',
      queryStringParameters: query,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createMockContext = (): Context =>
    ({
      functionName: 'list-workflow-key-outputs',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:list-workflow-key-outputs',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/list-workflow-key-outputs',
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

    mockQueryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId =
      mockQueryByLaboratoryId;

    mockGet = jest.fn().mockResolvedValue(undefined);
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = mockGet;
  });

  it('returns an empty KeyOutputs array when nothing has been declared', async () => {
    const result = await handler(
      createMockEvent({ laboratoryId: LAB_ID, workflowId: WORKFLOW_ID }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toEqual([]);
    expect(body.LaboratoryId).toEqual(LAB_ID);
    expect(body.WorkflowId).toEqual(WORKFLOW_ID);
  });

  it('returns the stored definition when one exists', async () => {
    mockGet.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      WorkflowName: 'nf-core/viralrecon',
      KeyOutputs: [{ KeyOutputId: 'id-1', Label: 'Consensus', Pattern: '*.consensus.fa' }],
    });

    const result = await handler(
      createMockEvent({ laboratoryId: LAB_ID, workflowId: WORKFLOW_ID }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toHaveLength(1);
    expect(body.WorkflowName).toEqual('nf-core/viralrecon');
  });

  it('rejects a request missing query parameters', async () => {
    const result = await handler(createMockEvent({}), createMockContext(), () => {});
    expect(result.statusCode).toEqual(400);
  });
});
