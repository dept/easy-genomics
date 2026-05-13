import { WorkflowStatus } from '@aws-sdk/client-omics';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockListByLaboratoryId = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service', () => ({
  LaboratoryWorkflowAccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListByLaboratoryId,
  })),
}));
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/list-workflow-versions.lambda';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-workflow-versions.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const WF_ID = '5734690';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/aws-healthomics/workflow/list-workflow-versions',
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
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'list-workflow-versions',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-workflow-versions',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-workflow-versions',
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

    mockListByLaboratoryId.mockReset();
    mockListByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: LAB_ID,
        WorkflowKey: `HEALTH_OMICS#${WF_ID}`,
        OrganizationId: ORG_ID,
      },
    ]);

    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockOmicsService.prototype.listWorkflowVersions = jest.fn();
  });

  it('returns ACTIVE and unset-status versions only', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    (mockOmicsService.prototype.listWorkflowVersions as jest.Mock).mockResolvedValue({
      items: [
        { versionName: 'active-one', status: WorkflowStatus.ACTIVE },
        { versionName: 'inactive', status: WorkflowStatus.INACTIVE },
        { versionName: 'no-status' },
      ],
      nextToken: 'token-1',
    });

    const result = await handler(
      createEvent({ laboratoryId: LAB_ID, workflowId: WF_ID }) as any,
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { versionName?: string }) => i.versionName)).toEqual(['active-one', 'no-status']);
    expect(body.nextToken).toBe('token-1');

    expect(mockOmicsService.prototype.listWorkflowVersions).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WF_ID,
        type: 'PRIVATE',
      }),
    );
  });

  it('rejects when laboratoryId is missing', async () => {
    const result = await handler(createEvent({ workflowId: WF_ID } as any), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });

  it('rejects when workflowId is missing', async () => {
    const result = await handler(createEvent({ laboratoryId: LAB_ID } as any), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });

  it('returns 404 when laboratory is not found', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(
      createEvent({ laboratoryId: LAB_ID, workflowId: WF_ID }) as any,
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(404);
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });

  it('denies access when user does not have org or lab role', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(
      createEvent({ laboratoryId: LAB_ID, workflowId: WF_ID }) as any,
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });

  it('returns 403 when laboratory does not have AWS HealthOmics enabled', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: false,
    });

    const result = await handler(
      createEvent({ laboratoryId: LAB_ID, workflowId: WF_ID }) as any,
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });

  it('denies workflow access when laboratory has no grant for that workflow', async () => {
    mockListByLaboratoryId.mockResolvedValueOnce([]);

    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    const result = await handler(
      createEvent({ laboratoryId: LAB_ID, workflowId: WF_ID }) as any,
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-104');
    expect(mockOmicsService.prototype.listWorkflowVersions).not.toHaveBeenCalled();
  });
});
