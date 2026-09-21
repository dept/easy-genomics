import { ConflictException, ResourceNotFoundException } from '@aws-sdk/client-omics';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/delete-private-workflow.lambda';

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

describe('delete-private-workflow.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const WF_ID = '5734690';
  const USER_SUB = 'user-sub-123';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const ownerTags = {
    Application: 'easy-genomics',
    LaboratoryId: LAB_ID,
    OrganizationId: ORG_ID,
    UserId: USER_SUB,
  };

  const createEvent = (
    workflowId: string | undefined,
    query: Record<string, string | undefined>,
    claims: Record<string, string> = { 'sub': USER_SUB, 'cognito:username': USER_SUB },
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'DELETE',
      path: `/aws-healthomics/workflow/delete-private-workflow/${workflowId ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims,
        },
      },
      resource: '',
      queryStringParameters: query,
      multiValueQueryStringParameters: null,
      pathParameters: workflowId ? { id: workflowId } : null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'delete-private-workflow',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:delete-private-workflow',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/delete-private-workflow',
      logStreamName: '2026/09/18/[$LATEST]test',
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

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(true);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });
    mockAccessService.prototype.remove = jest.fn().mockResolvedValue(undefined);
    mockOmicsService.prototype.listSharedWorkflows = jest.fn().mockResolvedValue({ shares: [] });
    mockOmicsService.prototype.getWorkflow = jest.fn().mockResolvedValue({
      id: WF_ID,
      name: 'my-workflow',
      tags: ownerTags,
    });
    mockOmicsService.prototype.deleteWorkflow = jest.fn().mockResolvedValue({});
    mockOmicsService.prototype.listWorkflowVersions = jest.fn().mockResolvedValue({ items: [] });
    mockOmicsService.prototype.deleteWorkflowVersion = jest.fn().mockResolvedValue({});
  });

  it('deletes a private workflow created by the caller', async () => {
    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ Status: 'Success' });
    expect(mockOmicsService.prototype.deleteWorkflow).toHaveBeenCalledWith({ id: WF_ID });
    expect(mockAccessService.prototype.remove).toHaveBeenCalledWith(LAB_ID, 'HEALTH_OMICS', WF_ID);
  });

  it('allows a lab technician with create access to delete their own workflow', async () => {
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.deleteWorkflow).toHaveBeenCalledWith({ id: WF_ID });
  });

  it('matches ownership using the custom UserId claim', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WF_ID,
      tags: { ...ownerTags, UserId: 'internal-user-id' },
    });

    const result = await handler(
      createEvent(WF_ID, { laboratoryId: LAB_ID }, { 'cognito:username': USER_SUB, 'UserId': 'internal-user-id' }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
  });

  it('deletes workflow versions then retries when the initial delete conflicts', async () => {
    (mockOmicsService.prototype.deleteWorkflow as jest.Mock)
      .mockRejectedValueOnce(new ConflictException({ message: 'workflow has versions', $metadata: {} }))
      .mockResolvedValueOnce({});
    (mockOmicsService.prototype.listWorkflowVersions as jest.Mock).mockResolvedValue({
      items: [{ versionName: 'v1' }],
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.deleteWorkflowVersion).toHaveBeenCalledWith({
      workflowId: WF_ID,
      versionName: 'v1',
    });
    expect(mockOmicsService.prototype.deleteWorkflow).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when a run is still using the workflow', async () => {
    (mockOmicsService.prototype.deleteWorkflow as jest.Mock).mockRejectedValue(
      new ConflictException({ message: 'workflow is in use', $metadata: {} }),
    );

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toContain('cannot be deleted while a run is using it');
  });

  it('returns 403 when the caller did not create the workflow', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WF_ID,
      tags: { ...ownerTags, UserId: 'someone-else' },
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 for a shared workflow', async () => {
    (mockOmicsService.prototype.listSharedWorkflows as jest.Mock).mockResolvedValue({
      shares: [{ resourceId: WF_ID, ownerId: '111122223333', status: 'ACTIVE' }],
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 when the workflow belongs to another laboratory', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WF_ID,
      tags: { ...ownerTags, LaboratoryId: 'other-lab' },
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 when the workflow was not created in Easy Genomics', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WF_ID,
      tags: { ...ownerTags, Application: 'aws-console' },
    });

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller cannot create workflows', async () => {
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
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 404 when the Omics workflow is not found', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockRejectedValue(
      new ResourceNotFoundException({ message: 'not found', $metadata: {} }),
    );

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('still succeeds if access-row cleanup fails after the workflow is deleted', async () => {
    (mockAccessService.prototype.remove as jest.Mock).mockRejectedValue(new Error('ddb unavailable'));

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
  });

  it('rejects when laboratoryId is missing', async () => {
    const result = await handler(createEvent(WF_ID, {}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('rejects when workflow id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent(WF_ID, { laboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
    expect(mockOmicsService.prototype.deleteWorkflow).not.toHaveBeenCalled();
  });
});
