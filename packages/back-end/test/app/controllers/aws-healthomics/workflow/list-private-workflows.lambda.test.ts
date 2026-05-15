import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/list-private-workflows.lambda';

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

describe('list-private-workflows.lambda', () => {
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
      path: '/aws-healthomics/workflow/list-private-workflows',
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
      functionName: 'list-private-workflows',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-private-workflows',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-private-workflows',
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
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockAccessService = LaboratoryWorkflowAccessService as jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockOmicsService.prototype.listWorkflows = jest.fn();
    mockAccessService.prototype.listByLaboratoryId = jest.fn();
  });

  it('filters Omics items by laboratory workflow access (strict default)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: false,
    });

    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValue({
      items: [
        { id: 'wf-allowed', name: 'Allowed' },
        { id: 'wf-blocked', name: 'Blocked' },
      ],
      nextToken: 't1',
    });

    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-allowed' },
    ]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body ?? '{}');
    expect(body.items).toEqual([{ id: 'wf-allowed', name: 'Allowed' }]);
    expect(body.nextToken).toBe('t1');
  });

  it('when new workflows are enabled by default, omits only explicitly denied workflows', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });

    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValue({
      items: [
        { id: 'wf-ok', name: 'Ok' },
        { id: 'wf-denied', name: 'Denied' },
      ],
    });

    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-denied', Effect: 'DENY' },
    ]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body ?? '{}');
    expect(body.items).toEqual([{ id: 'wf-ok', name: 'Ok' }]);
  });
});
