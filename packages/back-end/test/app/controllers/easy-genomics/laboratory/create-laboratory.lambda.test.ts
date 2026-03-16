import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/create-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/organization-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/ssm-service');
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../src/app/utils/rest-api-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { OrganizationService } from '../../../../../src/app/services/easy-genomics/organization-service';
import { SsmService } from '../../../../../src/app/services/ssm-service';
import { validateOrganizationAdminAccess } from '../../../../../src/app/utils/auth-utils';
import { httpRequest } from '../../../../../src/app/utils/rest-api-utils';

describe('create-laboratory.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';

  let mockOrgService: jest.MockedClass<typeof OrganizationService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/create',
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
      functionName: 'create-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:create-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/create-laboratory',
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
    OrganizationId: ORG_ID,
    Name: 'Lab 1',
    Description: 'desc',
    S3Bucket: 'bucket',
    Status: 'Active',
    AwsHealthOmicsEnabled: true,
    NextFlowTowerEnabled: true,
    NextFlowTowerApiBaseUrl: 'https://tower.example.com',
    NextFlowTowerWorkspaceId: 'ws-1',
    NextFlowTowerAccessToken: 'token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgService = OrganizationService as jest.MockedClass<typeof OrganizationService>;
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockSsmService = SsmService as jest.MockedClass<typeof SsmService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);

    (httpRequest as jest.Mock).mockResolvedValue({
      items: [],
    });

    mockOrgService.prototype.get = jest.fn();
    mockLabService.prototype.add = jest.fn();
    mockSsmService.prototype.putParameter = jest.fn();
  });

  it('creates laboratory successfully and stores NF access token', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      AwsHealthOmicsEnabled: true,
      NextFlowTowerEnabled: true,
    });

    (mockLabService.prototype.add as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
    });

    (mockSsmService.prototype.putParameter as jest.Mock).mockResolvedValue({});

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.LaboratoryId).toBeDefined();
    expect(mockOrgService.prototype.get).toHaveBeenCalledWith(ORG_ID);
    expect(mockLabService.prototype.add).toHaveBeenCalled();
    expect(mockSsmService.prototype.putParameter).toHaveBeenCalled();
  });

  it('returns 400 for invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.add).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not organization admin', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
    expect(mockLabService.prototype.add).not.toHaveBeenCalled();
  });

  it('returns 404 when organization is not found', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue(undefined);

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when NF integration validation fails', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
    });

    (httpRequest as jest.Mock).mockRejectedValue(new Error('NF error'));

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('maps ConditionalCheckFailedException to LaboratoryAlreadyExistsError', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
    });

    (mockLabService.prototype.add as jest.Mock).mockRejectedValue(
      new ConditionalCheckFailedException({ message: 'Conditional check failed', $metadata: {} } as any),
    );

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('maps TransactionCanceledException to LaboratoryNameTakenError', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
    });

    (mockLabService.prototype.add as jest.Mock).mockRejectedValue(
      new TransactionCanceledException({ message: 'Transaction canceled', $metadata: {} } as any),
    );

    const result = await handler(createEvent(baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(409);
  });

  it('does not call NF validation or SSM when NextFlowTowerEnabled is false', async () => {
    (mockOrgService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
    });

    const requestWithoutNf = {
      ...baseRequest,
      NextFlowTowerEnabled: false,
      NextFlowTowerApiBaseUrl: undefined,
      NextFlowTowerWorkspaceId: undefined,
      NextFlowTowerAccessToken: undefined,
    };

    (mockLabService.prototype.add as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(createEvent(requestWithoutNf), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(httpRequest as jest.Mock).not.toHaveBeenCalled();
    expect(mockSsmService.prototype.putParameter).not.toHaveBeenCalled();
  });
});
