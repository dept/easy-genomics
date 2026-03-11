import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/read-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/ssm-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { SsmService } from '../../../../../src/app/services/ssm-service';
import {
  validateOrganizationAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('read-laboratory.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const OTHER_LAB_ID = '00000000-0000-0000-0000-000000000003';
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockValidateOrgAccess: jest.MockedFunction<typeof validateOrganizationAccess>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateSystemAdmin: jest.MockedFunction<typeof validateSystemAdminAccess>;

  const createEvent = (id: string | undefined, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: `/laboratory/${id ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: id ? { id } : null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'read-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:read-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/read-laboratory',
      logStreamName: '2026/03/11/[$LATEST]test',
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
    mockSsmService = SsmService as jest.MockedClass<typeof SsmService>;
    mockValidateOrgAccess = validateOrganizationAccess as any;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateSystemAdmin = validateSystemAdminAccess as any;

    mockValidateOrgAccess.mockReturnValue(true);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(false);

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockSsmService.prototype.getParameter = jest.fn();
  });

  it('returns laboratory details for an owned lab with HasNextFlowTowerAccessToken when token exists', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      Name: 'Lab 1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    const event = createEvent(LAB_ID);
    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.OrganizationId).toBe(ORG_ID);
    expect(body.HasNextFlowTowerAccessToken).toBe(true);
    expect(mockValidateOrgAccess).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
  });

  it('allows a system admin to read any laboratory regardless of ownership', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: OTHER_LAB_ID,
      Name: 'Other Lab',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    mockValidateSystemAdmin.mockReturnValue(true);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateOrgAccess.mockReturnValue(false);

    const result = await handler(createEvent(OTHER_LAB_ID), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.LaboratoryId).toBe(OTHER_LAB_ID);
  });

  it('returns 400 when id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 403 when caller is not system admin, org admin, or org user', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    mockValidateOrgAccess.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(false);

    const result = await handler(createEvent('lab-1'), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });
});
