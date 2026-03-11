import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/list-laboratories.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/user-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { UserService } from '../../../../../src/app/services/easy-genomics/user-service';
import {
  getLaboratoryAccessLaboratoryIds,
  validateOrganizationAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
  verifyCurrentOrganizationAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('list-laboratories.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockUserService: jest.MockedClass<typeof UserService>;
  let mockValidateOrgAccess: jest.MockedFunction<typeof validateOrganizationAccess>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateSystemAdmin: jest.MockedFunction<typeof validateSystemAdminAccess>;
  let mockVerifyCurrentOrgAccess: jest.MockedFunction<typeof verifyCurrentOrganizationAccess>;
  let mockGetLabAccessIds: jest.MockedFunction<typeof getLaboratoryAccessLaboratoryIds>;

  const createEvent = (
    organizationId: string | undefined,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/list',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: organizationId ? { organizationId } : null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'list-laboratories',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-laboratories',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-laboratories',
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
    mockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockValidateOrgAccess = validateOrganizationAccess as any;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateSystemAdmin = validateSystemAdminAccess as any;
    mockVerifyCurrentOrgAccess = verifyCurrentOrganizationAccess as any;
    mockGetLabAccessIds = getLaboratoryAccessLaboratoryIds as any;

    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateOrgAccess.mockReturnValue(true);
    mockVerifyCurrentOrgAccess.mockReturnValue(true);
    mockGetLabAccessIds.mockReturnValue(['lab-1']);

    mockLabService.prototype.queryByOrganizationId = jest.fn();
    mockUserService.prototype.queryByEmail = jest.fn();
  });

  it('returns 400 when organizationId query parameter is missing', async () => {
    const result = await handler(createEvent(undefined), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns laboratories for organization as system admin without filtering', async () => {
    mockValidateSystemAdmin.mockReturnValue(true);
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1' },
      { OrganizationId: 'org-1', LaboratoryId: 'lab-2' },
    ]);

    const result = await handler(createEvent('org-1'), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(2);
  });

  it('filters laboratories by user access when not admin', async () => {
    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockGetLabAccessIds.mockReturnValue(['lab-1', 'lab-3']);

    (mockUserService.prototype.queryByEmail as jest.Mock).mockResolvedValue([
      { UserId: 'user-1', Email: 'user@example.com' },
    ]);
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1' },
      { OrganizationId: 'org-1', LaboratoryId: 'lab-2' },
      { OrganizationId: 'org-1', LaboratoryId: 'lab-3' },
    ]);

    const result = await handler(createEvent('org-1'), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    const returnedIds = body.map((lab: any) => lab.LaboratoryId).sort();
    expect(returnedIds).toEqual(['lab-1', 'lab-3']);
    expect(mockGetLabAccessIds).toHaveBeenCalledWith(expect.anything(), 'org-1');
  });

  it('returns an empty list when user has organization access but no laboratory access', async () => {
    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateOrgAccess.mockReturnValue(true);
    mockGetLabAccessIds.mockReturnValue([]);

    (mockUserService.prototype.queryByEmail as jest.Mock).mockResolvedValue([
      { UserId: 'user-1', Email: 'user@example.com' },
    ]);
    (mockLabService.prototype.queryByOrganizationId as jest.Mock).mockResolvedValue([
      { OrganizationId: 'org-1', LaboratoryId: 'lab-1' },
      { OrganizationId: 'org-1', LaboratoryId: 'lab-2' },
    ]);

    const result = await handler(createEvent('org-1'), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });

  it('returns 403 when user has no organization access', async () => {
    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAccess.mockReturnValue(false);

    (mockUserService.prototype.queryByEmail as jest.Mock).mockResolvedValue([
      { UserId: 'user-1', Email: 'user@example.com' },
    ]);

    const result = await handler(createEvent('org-1'), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });
});
