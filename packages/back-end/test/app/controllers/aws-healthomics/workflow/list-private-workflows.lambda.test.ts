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
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminOrLaboratoryManagerAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-private-workflows.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockAccessService: jest.MockedClass<typeof LaboratoryWorkflowAccessService>;
  let mockValidateAdminOrManager: jest.MockedFunction<typeof validateOrganizationAdminOrLaboratoryManagerAccess>;
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
    mockValidateAdminOrManager = validateOrganizationAdminOrLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateAdminOrManager.mockReturnValue(true);
    mockValidateLabTechnician.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockOmicsService.prototype.listWorkflows = jest.fn();
    mockOmicsService.prototype.listTagsForResource = jest.fn();
    mockAccessService.prototype.listByLaboratoryId = jest.fn();
  });

  it('filters Omics items by laboratory workflow access (strict default)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: false,
    });

    // Paginated: first page carries a nextToken, second page terminates. The
    // filter must be applied across every page, not just the first.
    (mockOmicsService.prototype.listWorkflows as jest.Mock)
      .mockResolvedValueOnce({
        items: [
          { id: 'wf-allowed', name: 'Allowed' },
          { id: 'wf-blocked', name: 'Blocked' },
        ],
        nextToken: 't1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'wf-allowed-2', name: 'Allowed 2' }],
        nextToken: undefined,
      });

    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-allowed' },
      { LaboratoryId: LAB_ID, WorkflowKey: 'HEALTH_OMICS#wf-allowed-2' },
    ]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res?.body ?? '{}');
    expect(body.items).toEqual([
      { id: 'wf-allowed', name: 'Allowed' },
      { id: 'wf-allowed-2', name: 'Allowed 2' },
    ]);
    expect(mockOmicsService.prototype.listWorkflows).toHaveBeenCalledTimes(2);
    expect(mockOmicsService.prototype.listTagsForResource).not.toHaveBeenCalled();
  });

  it('when new workflows are enabled by default, omits only explicitly denied workflows', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });

    // Single page (no nextToken) terminates pagination after one call.
    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValueOnce({
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

  it('attaches creator tags for org admins and lab managers', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });
    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 'wf-tagged', name: 'Tagged', arn: 'arn:aws:omics:us-east-1:123:workflow/wf-tagged' },
        { id: 'wf-no-arn', name: 'No arn' },
      ],
    });
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([]);
    (mockOmicsService.prototype.listTagsForResource as jest.Mock).mockResolvedValue({
      tags: { UserId: 'user-1', Application: 'easy-genomics' },
    });

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res?.body ?? '{}').items).toEqual([
      {
        id: 'wf-tagged',
        name: 'Tagged',
        arn: 'arn:aws:omics:us-east-1:123:workflow/wf-tagged',
        tags: { UserId: 'user-1', Application: 'easy-genomics' },
      },
      { id: 'wf-no-arn', name: 'No arn' },
    ]);
    expect(mockOmicsService.prototype.listTagsForResource).toHaveBeenCalledTimes(1);
  });

  it('leaves tags unset when ListTagsForResource fails so the UI can fail closed', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });
    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValueOnce({
      items: [{ id: 'wf-1', name: 'One', arn: 'arn:aws:omics:us-east-1:123:workflow/wf-1' }],
    });
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([]);
    (mockOmicsService.prototype.listTagsForResource as jest.Mock).mockRejectedValue(new Error('throttled'));

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res?.body ?? '{}').items).toEqual([
      { id: 'wf-1', name: 'One', arn: 'arn:aws:omics:us-east-1:123:workflow/wf-1' },
    ]);
  });

  it('does not look up tags for laboratory technicians', async () => {
    mockValidateAdminOrManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(true);
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      EnableNewWorkflowsByDefault: true,
    });
    (mockOmicsService.prototype.listWorkflows as jest.Mock).mockResolvedValueOnce({
      items: [{ id: 'wf-1', name: 'One', arn: 'arn:aws:omics:us-east-1:123:workflow/wf-1' }],
    });
    (mockAccessService.prototype.listByLaboratoryId as jest.Mock).mockResolvedValue([]);

    const res = await handler(createEvent({ laboratoryId: LAB_ID }), createContext(), () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res?.body ?? '{}').items).toEqual([
      { id: 'wf-1', name: 'One', arn: 'arn:aws:omics:us-east-1:123:workflow/wf-1' },
    ]);
    expect(mockOmicsService.prototype.listTagsForResource).not.toHaveBeenCalled();
  });
});
