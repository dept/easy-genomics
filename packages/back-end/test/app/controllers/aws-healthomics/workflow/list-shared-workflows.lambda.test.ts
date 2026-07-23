import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/list-shared-workflows.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '../../../../../src/app/services/easy-genomics/laboratory-workflow-access-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-shared-workflows.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
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
      path: '/aws-healthomics/workflow/list-shared-workflows',
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
      functionName: 'list-shared-workflows',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-shared-workflows',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-shared-workflows',
      logStreamName: '2026/07/22/[$LATEST]test',
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
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockAccessService = LaboratoryWorkflowAccessService as jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockOmicsService.prototype.listSharedWorkflows = jest.fn();
    mockAccessService.prototype.listByLaboratoryId = jest.fn();
  });

  it('filters shared workflows by laboratory access across all ListShares pages (strict)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: false,
    });

    (mockOmicsService.prototype.listSharedWorkflows as jest.Mock)
      .mockResolvedValueOnce({
        shares: [
          {
            resourceId: 'wf-allowed',
            shareName: 'Allowed Shared',
            ownerId: '111122223333',
            status: 'ACTIVE',
          },
          {
            resourceId: 'wf-blocked',
            shareName: 'Blocked Shared',
            ownerId: '111122223333',
            status: 'ACTIVE',
          },
        ],
        nextToken: 't1',
      })
      .mockResolvedValueOnce({
        shares: [
          {
            resourceArn: 'arn:aws:omics:us-east-1:999988887777:workflow/wf-allowed-2',
            shareName: 'Allowed Shared 2',
            status: 'ACTIVE',
          },
          {
            resourceId: 'wf-pending',
            shareName: 'Pending',
            ownerId: '111122223333',
            status: 'PENDING',
          },
        ],
      });

    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-allowed' },
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-allowed-2' },
    ]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body ?? '{}');
    expect(body.items).toEqual([
      {
        id: 'wf-allowed',
        name: 'Allowed Shared',
        source: 'SHARED',
        ownerAccountId: '111122223333',
      },
      {
        id: 'wf-allowed-2',
        name: 'Allowed Shared 2',
        source: 'SHARED',
        ownerAccountId: '999988887777',
      },
    ]);
    expect(mockOmicsService.prototype.listSharedWorkflows).toHaveBeenCalledTimes(2);
  });

  it('when new workflows are enabled by default, omits only explicitly denied shared workflows', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });

    (mockOmicsService.prototype.listSharedWorkflows as jest.Mock).mockResolvedValueOnce({
      shares: [
        { resourceId: 'wf-ok', shareName: 'Ok', ownerId: '111122223333', status: 'ACTIVE' },
        { resourceId: 'wf-denied', shareName: 'Denied', ownerId: '111122223333', status: 'ACTIVE' },
      ],
    });

    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-denied', Effect: 'DENY' },
    ]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body ?? '{}');
    expect(body.items).toEqual([
      { id: 'wf-ok', name: 'Ok', source: 'SHARED', ownerAccountId: '111122223333' },
    ]);
  });
});
