import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/edit-workflow-key-output-delivery.lambda';

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
const KEY_OUTPUT = {
  KeyOutputId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  Label: 'Summary',
  Pattern: 'reports/summary.html',
};

describe('edit-workflow-key-output-delivery Lambda', () => {
  let mockGet: jest.Mock;
  let mockSave: jest.Mock;

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/workflow-key-outputs/edit-workflow-key-output-delivery',
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
      functionName: 'edit-workflow-key-output-delivery',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({ OrganizationId: 'org-1', LaboratoryId: LAB_ID });

    mockGet = jest.fn().mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      KeyOutputs: [KEY_OUTPUT],
      CreatedAt: '2026-01-01T00:00:00.000Z',
      CreatedBy: 'original-user',
    });
    mockSave = jest.fn(async (definition) => definition);
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = mockGet;
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.save = mockSave;
  });

  it('saves the destination and keeps the declared key outputs', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 's3://results-bucket/incoming/viralrecon',
      }),
      createMockContext(),
      () => {},
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toEqual(200);
    expect(body.KeyOutputs).toEqual([KEY_OUTPUT]);
    expect(body.Delivery).toEqual({
      Enabled: true,
      DestinationUri: 's3://results-bucket/incoming/viralrecon/',
    });
    expect(body.CreatedBy).toEqual('original-user');
  });

  it('rejects a technician', async () => {
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(true);

    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 's3://results-bucket/incoming',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects an enabled delivery with no destination', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects a non-s3 destination URI', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 'https://results-bucket/incoming',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects an Easy Genomics platform bucket', async () => {
    process.env.NAME_PREFIX = 'eg-test';
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 's3://eg-test-org-email-assets-bucket/inbox',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('saves the Microreact roles alongside the S3 setting', async () => {
    const microreact = { Enabled: true, MetadataKeyOutputId: KEY_OUTPUT.KeyOutputId };
    const result = await handler(
      createMockEvent({ LaboratoryId: LAB_ID, WorkflowId: WORKFLOW_ID, Enabled: false, Microreact: microreact }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body).Delivery).toEqual({ Enabled: false, Microreact: microreact });
  });

  it('saves Microreact as disabled when the request omits Enabled', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: false,
        Microreact: { MetadataKeyOutputId: KEY_OUTPUT.KeyOutputId },
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body).Delivery.Microreact).toEqual({
      Enabled: false,
      MetadataKeyOutputId: KEY_OUTPUT.KeyOutputId,
    });
  });

  it('keeps the saved Microreact roles when the request omits them', async () => {
    const microreact = { Enabled: true, MetadataKeyOutputId: KEY_OUTPUT.KeyOutputId };
    mockGet.mockResolvedValue({
      LaboratoryId: LAB_ID,
      WorkflowId: WORKFLOW_ID,
      KeyOutputs: [KEY_OUTPUT],
      Delivery: { Enabled: false, Microreact: microreact },
    });

    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 's3://results-bucket/incoming',
      }),
      createMockContext(),
      () => {},
    );

    expect(JSON.parse(result.body).Delivery.Microreact).toEqual(microreact);
  });

  it('rejects a Microreact role that is not a declared key output', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: false,
        Microreact: { Enabled: true, MetadataKeyOutputId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('rejects a laboratory data prefix destination', async () => {
    const result = await handler(
      createMockEvent({
        LaboratoryId: LAB_ID,
        WorkflowId: WORKFLOW_ID,
        Enabled: true,
        DestinationUri: 's3://lab-bucket/b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f/c2f1e7b5-2e3c-5b7e-0a2d-2b3c4d5e6f70/out',
      }),
      createMockContext(),
      () => {},
    );

    expect(result.statusCode).toEqual(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
