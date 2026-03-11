import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/edit-laboratory-user.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/platform-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/user-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';
import { PlatformUserService } from '../../../../../../src/app/services/easy-genomics/platform-user-service';
import { UserService } from '../../../../../../src/app/services/easy-genomics/user-service';
import {
  validateLaboratoryManagerAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

describe('edit-laboratory-user.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;
  let mockPlatformUserService: jest.MockedClass<typeof PlatformUserService>;
  let mockUserService: jest.MockedClass<typeof UserService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'PUT',
      path: '/laboratory/user/edit',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'admin@example.com',
            'cognito:username': 'admin-user',
          },
        },
      },
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'edit-laboratory-user',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:edit-laboratory-user',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/edit-laboratory-user',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  const baseRequest = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    UserId: 'user-1',
    LabManager: false,
    LabTechnician: true,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockLabUserService = LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>;
    mockPlatformUserService = PlatformUserService as jest.MockedClass<typeof PlatformUserService>;
    mockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
  });

  it('edits existing laboratory user mapping when caller has access', async () => {
    (mockLabUserService.prototype.get as jest.Mock).mockResolvedValue({
      LaboratoryId: 'lab-1',
      UserId: 'user-1',
      LabManager: true,
      LabTechnician: false,
    });
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: 'user-1',
    });
    (mockPlatformUserService.prototype.editExistingUserAccessToLaboratory as jest.Mock).mockResolvedValue(true);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('Success');
    expect(mockPlatformUserService.prototype.editExistingUserAccessToLaboratory).toHaveBeenCalled();
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockPlatformUserService.prototype.editExistingUserAccessToLaboratory).not.toHaveBeenCalled();
  });

  it('denies access when caller is neither org admin nor lab manager', async () => {
    (mockLabUserService.prototype.get as jest.Mock).mockResolvedValue({
      LaboratoryId: 'lab-1',
      UserId: 'user-1',
    });
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: 'user-1',
    });

    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });
});
