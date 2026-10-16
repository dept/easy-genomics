import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/edit-workflow-key-outputs.lambda';

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

describe('edit-workflow-key-outputs Lambda', () => {
  let mockSave: jest.Mock;

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/workflow-key-outputs/edit-workflow-key-outputs',
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
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(true);

    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({ OrganizationId: 'org-1', LaboratoryId: LAB_ID });

    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Delivery: { Enabled: false },
        CreatedAt: '2026-01-01T00:00:00.000Z',
        CreatedBy: 'original-user',
      });
    mockSave = jest.fn(async (definition) => definition);
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.save = mockSave;
  });

  it('keeps the delivery setting when key outputs are saved', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        KeyOutputs: [{ Label: 'Summary', Pattern: 'reports/summary.html' }],
      }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.Delivery).toEqual({ Enabled: false });
    expect(body.KeyOutputs[0].Pattern).toEqual('reports/summary.html');
    expect(body.CreatedBy).toEqual('original-user');
  });

  it('allows a technician to clear declared key outputs when delivery is off', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        KeyOutputs: [],
      }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toEqual([]);
    expect(mockSave).toHaveBeenCalled();
  });

  it('allows a manager to save key outputs when delivery is already enabled', async () => {
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Delivery: { Enabled: true, DestinationUri: 's3://results-bucket/incoming/' },
        CreatedAt: '2026-01-01T00:00:00.000Z',
        CreatedBy: 'original-user',
      });

    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        KeyOutputs: [{ Label: 'Summary', Pattern: 'reports/*.html' }],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(200);
    expect(mockSave).toHaveBeenCalled();
  });

  it('rejects a technician when delivery is already enabled', async () => {
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = jest
      .fn()
      .mockResolvedValue({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Delivery: { Enabled: true, DestinationUri: 's3://results-bucket/incoming/' },
      });

    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        KeyOutputs: [{ Label: 'Summary', Pattern: 'reports/*.html' }],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects a caller with no laboratory access', async () => {
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        KeyOutputs: [{ Label: 'Summary', Pattern: 'reports/summary.html' }],
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(403);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
