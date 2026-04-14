import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockQueryByLaboratoryId = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/workflow-run-index-service', () => ({
  WorkflowRunIndexService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: mockQueryByLaboratoryId,
  })),
}));
jest.mock('../../../../../src/app/utils/auth-utils');

import { handler } from '../../../../../src/app/controllers/aws-healthomics/run/list-runs.lambda';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  validateOrganizationAdminAccess,
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-runs.lambda (DDB-backed)', () => {
  const LAB_ID = 'lab-123';
  const ORG_ID = 'org-123';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  const createEvent = (
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/aws-healthomics/run/list-runs',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'cognito:username': 'user-123',
            'OrganizationAccess': JSON.stringify({ [ORG_ID]: { Status: 'Active' } }),
          },
        },
      },
      resource: '',
      queryStringParameters: {
        laboratoryId: LAB_ID,
      },
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context => ({}) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryByLaboratoryId.mockReset();

    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockLabService.prototype.queryByLaboratoryId = jest.fn();

    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);
  });

  it('returns only HealthOmics runs from index', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
    });

    mockQueryByLaboratoryId.mockResolvedValue([
      {
        LaboratoryId: LAB_ID,
        RunId: '11111111-1111-1111-1111-111111111111',
        UserId: '22222222-2222-2222-2222-222222222222',
        OrganizationId: ORG_ID,
        RunName: 'Omics A',
        Platform: 'AWS HealthOmics',
        Status: 'RUNNING',
        Owner: 'user@example.com',
        ExternalRunId: 'run-abc',
        CreatedAt: new Date().toISOString(),
      },
      {
        LaboratoryId: LAB_ID,
        RunId: '33333333-3333-3333-3333-333333333333',
        UserId: '22222222-2222-2222-2222-222222222222',
        OrganizationId: ORG_ID,
        RunName: 'Seqera B',
        Platform: 'Seqera Cloud',
        Status: 'RUNNING',
        Owner: 'user@example.com',
        ExternalRunId: 'tower-123',
        CreatedAt: new Date().toISOString(),
      },
    ]);

    const res = await handler(createEvent(), createContext(), () => {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('run-abc');
    expect(body.items[0].name).toBe('Omics A');
  });
});
