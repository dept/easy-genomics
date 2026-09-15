import { ResourceNotFoundException } from '@aws-sdk/client-omics';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/read-private-workflow.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service');
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('read-private-workflow.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const WF_ID = '5734690';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    workflowId: string | undefined,
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: `/aws-healthomics/workflow/read-private-workflow/${workflowId ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: query,
      multiValueQueryStringParameters: null,
      pathParameters: workflowId ? { id: workflowId } : null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'read-private-workflow',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:read-private-workflow',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/read-private-workflow',
      logStreamName: '2026/03/24/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockAccessService = LaboratoryWorkflowAccessService as jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: false,
    });
    mockAccessService.prototype.listByLaboratoryId = jest
      .fn()
      .mockResolvedValue([{ LaboratoryId: LAB_ID, WorkflowKey: `HEALTH_OMICS#${WF_ID}` }]);
    mockOmicsService.prototype.getWorkflow = jest.fn().mockResolvedValue({ id: WF_ID, name: 'wf' });
    mockOmicsService.prototype.listSharedWorkflows = jest.fn().mockResolvedValue({ shares: [] });
  });

  it('omits workflowOwnerId for a private (non-shared) workflow', async () => {
    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PRIVATE',
        id: WF_ID,
      }),
    );
    expect(mockOmicsService.prototype.getWorkflow.mock.calls[0][0].workflowOwnerId).toBeUndefined();
  });

  it('resolves workflowOwnerId from ListShares for a shared workflow', async () => {
    (mockOmicsService.prototype.listSharedWorkflows as jest.Mock).mockResolvedValue({
      shares: [
        {
          resourceId: WF_ID,
          ownerId: '111122223333',
          status: 'ACTIVE',
        },
      ],
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PRIVATE',
        id: WF_ID,
        workflowOwnerId: '111122223333',
      }),
    );
  });

  it('ignores a client-supplied workflowOwnerId query param', async () => {
    (mockOmicsService.prototype.listSharedWorkflows as jest.Mock).mockResolvedValue({
      shares: [
        {
          resourceId: WF_ID,
          ownerId: '111122223333',
          status: 'ACTIVE',
        },
      ],
    });

    const result = await handler(
      createEvent(WF_ID, { laboratoryId: LAB_ID, workflowOwnerId: '999988887777' }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowOwnerId: '111122223333',
      }),
    );
  });

  it('denies when laboratory workflow access grant is missing', async () => {
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([]);

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });

  it('returns 404 when the Omics workflow is not found', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockRejectedValue(
      new ResourceNotFoundException({ message: 'not found', $metadata: {} }),
    );

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('rejects when laboratoryId is missing', async () => {
    const result = await handler(createEvent(WF_ID, {}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });

  it('rejects when workflow id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });

  it('denies access when user does not have org or lab role', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 when laboratory does not have AWS HealthOmics enabled', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: false,
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
  });
});
