import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { LaboratoryUserNotFoundError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/add-laboratory-user.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/organization-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/platform-user-service');
jest.mock('../../../../../../src/app/services/easy-genomics/user-service');
jest.mock('../../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';
import { OrganizationUserService } from '../../../../../../src/app/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '../../../../../../src/app/services/easy-genomics/platform-user-service';
import { UserService } from '../../../../../../src/app/services/easy-genomics/user-service';
import {
  validateLaboratoryManagerAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000003';

describe('add-laboratory-user.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;
  let mockOrgUserService: jest.MockedClass<typeof OrganizationUserService>;
  let mockPlatformUserService: jest.MockedClass<typeof PlatformUserService>;
  let mockUserService: jest.MockedClass<typeof UserService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/user/add',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            'email': 'admin@example.com',
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
      functionName: 'add-laboratory-user',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:add-laboratory-user',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/add-laboratory-user',
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
    LaboratoryId: LAB_ID,
    UserId: USER_ID,
    Status: 'Active',
    LabManager: true,
    LabTechnician: false,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockLabUserService = LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>;
    mockOrgUserService = OrganizationUserService as jest.MockedClass<typeof OrganizationUserService>;
    mockPlatformUserService = PlatformUserService as jest.MockedClass<typeof PlatformUserService>;
    mockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockLabUserService.prototype.get = jest.fn();
    mockOrgUserService.prototype.get = jest.fn();

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
  });

  it('adds existing user to laboratory when caller is org admin and mapping does not exist', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: USER_ID,
    });
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      UserId: USER_ID,
    });
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValueOnce(
      new LaboratoryUserNotFoundError(LAB_ID, USER_ID),
    );
    (mockPlatformUserService.prototype.addExistingUserToLaboratory as jest.Mock).mockResolvedValue(true);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('Success');
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).toHaveBeenCalled();
  });

  it('rejects invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).not.toHaveBeenCalled();
  });

  it('denies access when caller is neither org admin nor lab manager', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);

    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: USER_ID,
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('returns error when user already has laboratory access mapping', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: USER_ID,
    });
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      UserId: USER_ID,
    });
    (mockLabUserService.prototype.get as jest.Mock).mockResolvedValue({
      LaboratoryId: LAB_ID,
      UserId: USER_ID,
    });

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.ErrorCode).toBe('EG-311');
  });

  it('maps ConditionalCheckFailedException from platformUserService to LaboratoryUserAlreadyExistsError', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: USER_ID,
    });
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      UserId: USER_ID,
    });
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValueOnce(
      new LaboratoryUserNotFoundError(LAB_ID, USER_ID),
    );
    (mockPlatformUserService.prototype.addExistingUserToLaboratory as jest.Mock).mockRejectedValue(
      new ConditionalCheckFailedException({ $metadata: {}, message: 'Conditional check failed' }),
    );

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.ErrorCode).toBe('EG-311');
  });
});
