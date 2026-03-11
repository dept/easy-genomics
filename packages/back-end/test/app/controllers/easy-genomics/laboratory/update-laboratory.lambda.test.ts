import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/update-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/ssm-service');
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../src/app/utils/rest-api-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { SsmService } from '../../../../../src/app/services/ssm-service';
import { validateOrganizationAdminAccess } from '../../../../../src/app/utils/auth-utils';
import { httpRequest } from '../../../../../src/app/utils/rest-api-utils';

describe('update-laboratory.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;

  const createEvent = (
    id: string | undefined,
    body: any,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'PUT',
      path: `/laboratory/${id ?? ''}`,
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
      pathParameters: id ? { id } : null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'update-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:update-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/update-laboratory',
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
    Name: 'Updated Lab',
    Description: 'New desc',
    S3Bucket: 'bucket',
    AwsHealthOmicsEnabled: true,
    NextFlowTowerEnabled: true,
    NextFlowTowerApiBaseUrl: 'https://tower.example.com',
    NextFlowTowerWorkspaceId: 'ws-1',
    NextFlowTowerAccessToken: 'token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockSsmService = SsmService as jest.MockedClass<typeof SsmService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    (httpRequest as jest.Mock).mockResolvedValue({ items: [] });
  });

  it('updates laboratory successfully and overwrites NF access token', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockSsmService.prototype.putParameter as jest.Mock).mockResolvedValue({});

    const result = await handler(createEvent('lab-1', baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.update).toHaveBeenCalled();
    expect(mockSsmService.prototype.putParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        Overwrite: true,
      }),
    );
  });

  it('returns 400 when id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for invalid request body', async () => {
    const result = await handler(createEvent('lab-1', {}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not organization admin', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await handler(createEvent('lab-1', baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when NF integration validation fails (no baseApiUrl)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(
      createEvent('lab-1', { ...baseRequest, NextFlowTowerApiBaseUrl: '' }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  it('uses stored NF access token when not provided in request', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'stored-token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    const result = await handler(
      createEvent('lab-1', { ...baseRequest, NextFlowTowerAccessToken: undefined }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockSsmService.prototype.getParameter).toHaveBeenCalled();
  });

  it('returns 409 when laboratory name is taken (TransactionCanceledException)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockLabService.prototype.update as jest.Mock).mockRejectedValue(new TransactionCanceledException({}));

    const result = await handler(createEvent('lab-1', baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(409);
  });

  it('does not call NF validation when NextFlowTowerEnabled is false', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const requestWithoutNf = {
      ...baseRequest,
      NextFlowTowerEnabled: false,
      NextFlowTowerApiBaseUrl: undefined,
      NextFlowTowerWorkspaceId: undefined,
      NextFlowTowerAccessToken: undefined,
    };

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(createEvent('lab-1', requestWithoutNf), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(httpRequest as jest.Mock).not.toHaveBeenCalled();
  });
});
