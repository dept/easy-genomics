import { LaboratoryUserNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/add-bulk-laboratory-users.lambda';

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
const USER_ID_1 = '00000000-0000-0000-0000-000000000003';
const USER_ID_2 = '00000000-0000-0000-0000-000000000004';

describe('add-bulk-laboratory-users.lambda', () => {
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
      path: '/laboratory/user/add-bulk-laboratory-users',
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
      functionName: 'add-bulk-laboratory-users',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:add-bulk-laboratory-users',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/add-bulk-laboratory-users',
      logStreamName: '2026/07/16/[$LATEST]test',
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
    Users: [
      { UserId: USER_ID_1, LabManager: false, LabTechnician: true },
      { UserId: USER_ID_2, LabManager: false, LabTechnician: true },
    ],
  };

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

    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
  });

  it('adds all users when none are already lab members', async () => {
    (mockUserService.prototype.get as jest.Mock).mockImplementation((userId: string) =>
      Promise.resolve({ UserId: userId }),
    );
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({ OrganizationId: ORG_ID });
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValue(
      new LaboratoryUserNotFoundError(LAB_ID, USER_ID_1),
    );
    (mockPlatformUserService.prototype.addExistingUserToLaboratory as jest.Mock).mockResolvedValue(true);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(
      expect.arrayContaining([
        { UserId: USER_ID_1, Outcome: 'Added' },
        { UserId: USER_ID_2, Outcome: 'Added' },
      ]),
    );
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).toHaveBeenCalledTimes(2);
  });

  it('skips a user who is already a lab member without failing the batch', async () => {
    (mockUserService.prototype.get as jest.Mock).mockImplementation((userId: string) =>
      Promise.resolve({ UserId: userId }),
    );
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({ OrganizationId: ORG_ID });
    (mockLabUserService.prototype.get as jest.Mock).mockImplementation((_labId: string, userId: string) =>
      userId === USER_ID_1
        ? Promise.resolve({ LaboratoryId: LAB_ID, UserId: USER_ID_1 })
        : Promise.reject(new LaboratoryUserNotFoundError(LAB_ID, userId)),
    );
    (mockPlatformUserService.prototype.addExistingUserToLaboratory as jest.Mock).mockResolvedValue(true);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ UserId: USER_ID_1, Outcome: 'Skipped' }),
        expect.objectContaining({ UserId: USER_ID_2, Outcome: 'Added' }),
      ]),
    );
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).toHaveBeenCalledTimes(1);
  });

  it('reports a per-user failure without aborting the rest of the batch', async () => {
    (mockUserService.prototype.get as jest.Mock).mockImplementation((userId: string) =>
      Promise.resolve({ UserId: userId }),
    );
    (mockOrgUserService.prototype.get as jest.Mock).mockResolvedValue({ OrganizationId: ORG_ID });
    (mockLabUserService.prototype.get as jest.Mock).mockRejectedValue(
      new LaboratoryUserNotFoundError(LAB_ID, USER_ID_1),
    );
    (mockPlatformUserService.prototype.addExistingUserToLaboratory as jest.Mock).mockImplementation(
      (_user: any, laboratoryUser: any) =>
        laboratoryUser.UserId === USER_ID_1
          ? Promise.reject(new Error('DynamoDB write failed'))
          : Promise.resolve(true),
    );

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ UserId: USER_ID_1, Outcome: 'Failed', Reason: 'DynamoDB write failed' }),
        { UserId: USER_ID_2, Outcome: 'Added' },
      ]),
    );
  });

  it('rejects the whole request when caller is neither org admin nor lab manager', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).not.toHaveBeenCalled();
  });

  it('rejects an empty Users array as an invalid request', async () => {
    const result = await handler(createEvent({ LaboratoryId: LAB_ID, Users: [] }), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockPlatformUserService.prototype.addExistingUserToLaboratory).not.toHaveBeenCalled();
  });
});
