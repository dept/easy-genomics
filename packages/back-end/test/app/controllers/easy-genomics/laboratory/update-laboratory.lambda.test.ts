import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/update-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/ssm-service');
jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-default-migration', () => ({
  migrateS3AccessOnDefaultModeChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-workflow-access-default-migration', () => ({
  migrateWorkflowAccessOnDefaultModeChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../src/app/utils/rest-api-utils');
jest.mock('../../../../../src/app/utils/laboratory-s3-access-utils', () => ({
  assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue(undefined),
}));

import { migrateS3AccessOnDefaultModeChange } from '../../../../../src/app/services/easy-genomics/laboratory-s3-access-default-migration';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import { SsmService } from '../../../../../src/app/services/ssm-service';
import { validateOrganizationAdminAccess } from '../../../../../src/app/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '../../../../../src/app/utils/laboratory-s3-access-utils';
import { httpRequest } from '../../../../../src/app/utils/rest-api-utils';

describe('update-laboratory.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
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
            'email': 'admin@example.com',
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
    Status: 'Active',
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

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockLabService.prototype.update = jest.fn();
    mockSsmService.prototype.getParameter = jest.fn();
    mockSsmService.prototype.putParameter = jest.fn();

    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockOmicsService.prototype.getConfiguration = jest.fn().mockResolvedValue({ status: 'ACTIVE' });
  });

  it('updates laboratory successfully and overwrites NF access token', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockSsmService.prototype.putParameter as jest.Mock).mockResolvedValue({});

    const result = await handler(createEvent(LAB_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.update).toHaveBeenCalled();
    expect(mockSsmService.prototype.putParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        Overwrite: true,
      }),
    );
  });

  it('passes NotificationsEnabled through to the service update call', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(
      createEvent(LAB_ID, { ...baseRequest, NotificationsEnabled: false }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({
        NotificationsEnabled: false,
      }),
      expect.anything(),
    );
  });

  it('preserves existing polling intervals when they are omitted from the request', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      RunListStatusPollIntervalSeconds: 180,
      RunDetailProgressPollIntervalSeconds: 45,
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        RunListStatusPollIntervalSeconds: undefined,
        RunDetailProgressPollIntervalSeconds: undefined,
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({
        RunListStatusPollIntervalSeconds: 180,
        RunDetailProgressPollIntervalSeconds: 45,
      }),
      expect.objectContaining({
        RunListStatusPollIntervalSeconds: 180,
        RunDetailProgressPollIntervalSeconds: 45,
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
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await handler(createEvent(LAB_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('returns 400 when NF integration validation fails (no baseApiUrl)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent(LAB_ID, { ...baseRequest, NextFlowTowerApiBaseUrl: '' }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  it('uses stored NF access token when not provided in request', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'stored-token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    const result = await handler(
      createEvent(LAB_ID, { ...baseRequest, NextFlowTowerAccessToken: undefined }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSsmService.prototype.getParameter).toHaveBeenCalled();
  });

  it('returns 409 when laboratory name is taken (TransactionCanceledException)', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    (mockLabService.prototype.update as jest.Mock).mockRejectedValue(
      new TransactionCanceledException({ message: 'Transaction canceled', $metadata: {} } as any),
    );

    const result = await handler(createEvent(LAB_ID, baseRequest), createContext(), () => {});

    expect(result.statusCode).toBe(409);
  });

  it('does not call NF validation when NextFlowTowerEnabled is false', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
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

    const result = await handler(createEvent(LAB_ID, requestWithoutNf), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(httpRequest as jest.Mock).not.toHaveBeenCalled();
  });

  it('validates and persists the VPC configuration when networking mode is VPC', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
    });
    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
      EnableNewWorkflowsByDefault: false,
    });

    const requestWithVpc = {
      ...baseRequest,
      NextFlowTowerEnabled: false,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    };

    const result = await handler(createEvent('lab-1', requestWithVpc), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.getConfiguration).toHaveBeenCalledWith({ name: 'wslh-prod-vpc' });
    expect(mockLabService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({
        AwsHealthOmicsNetworkingMode: 'VPC',
        AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
      }),
      expect.anything(),
    );
  });

  it('returns 400 when the referenced VPC configuration is not ACTIVE', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
    });
    (mockOmicsService.prototype.getConfiguration as jest.Mock).mockResolvedValue({ status: 'DELETING' });

    const requestWithVpc = {
      ...baseRequest,
      NextFlowTowerEnabled: false,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    };

    const result = await handler(createEvent('lab-1', requestWithVpc), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('persists a disabled lab that still holds a previously-saved VPC config, unchanged', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
      AwsHealthOmicsEnabled: true,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    });
    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: 'lab-1',
      AwsHealthOmicsEnabled: false,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
      EnableNewWorkflowsByDefault: false,
    });

    const requestDisablingHealthOmics = {
      ...baseRequest,
      NextFlowTowerEnabled: false,
      AwsHealthOmicsEnabled: false,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    };

    const result = await handler(createEvent('lab-1', requestDisablingHealthOmics), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockOmicsService.prototype.getConfiguration).toHaveBeenCalledWith({ name: 'wslh-prod-vpc' });
    expect(mockLabService.prototype.update).toHaveBeenCalledWith(
      expect.objectContaining({
        AwsHealthOmicsEnabled: false,
        AwsHealthOmicsNetworkingMode: 'VPC',
        AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
      }),
      expect.anything(),
    );
  });

  it('skips S3 access assert when only EnableNewBucketsByDefault changes', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      S3Bucket: 'bucket',
      EnableNewBucketsByDefault: true,
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      S3Bucket: 'bucket',
      EnableNewBucketsByDefault: false,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
        EnableNewBucketsByDefault: false,
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(assertLaboratoryHasS3BucketAccess).not.toHaveBeenCalled();
    expect(migrateS3AccessOnDefaultModeChange).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      laboratoryId: LAB_ID,
      previousDefaultOn: true,
      nextDefaultOn: false,
    });
  });

  it('returns 400 when HealthOmics LLM provider changes to openai without a new API key', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      HealthOmicsLlmProvider: 'anthropic',
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
        HealthOmicsLlmProvider: 'openai',
        HealthOmicsLlmModelId: 'gpt-4o',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('allows the HealthOmics LLM provider change to openai when a new API key is supplied', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      HealthOmicsLlmProvider: 'anthropic',
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
        HealthOmicsLlmProvider: 'openai',
        HealthOmicsLlmModelId: 'gpt-4o',
        HealthOmicsLlmApiKey: 'new-openai-key',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockSsmService.prototype.putParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: `/easy-genomics/organization/${ORG_ID}/laboratory/${LAB_ID}/llm-api-key-healthomics`,
        Value: 'new-openai-key',
      }),
    );
  });

  it('allows saving without a new API key when the HealthOmics LLM provider is unchanged', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      HealthOmicsLlmProvider: 'openai',
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
        HealthOmicsLlmProvider: 'openai',
        HealthOmicsLlmModelId: 'gpt-4o',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockSsmService.prototype.putParameter).not.toHaveBeenCalledWith(
      expect.objectContaining({
        Name: `/easy-genomics/organization/${ORG_ID}/laboratory/${LAB_ID}/llm-api-key-healthomics`,
      }),
    );
  });

  it('allows switching the HealthOmics LLM provider to bedrock without an API key', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      AwsHealthOmicsEnabled: true,
      HealthOmicsLlmProvider: 'anthropic',
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
        HealthOmicsLlmProvider: 'bedrock',
        HealthOmicsLlmModelId: 'anthropic.claude-3-sonnet',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
  });

  it('asserts S3 access when S3Bucket changes', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      S3Bucket: 'old-bucket',
      EnableNewBucketsByDefault: false,
    });

    (mockLabService.prototype.update as jest.Mock).mockResolvedValue({
      OrganizationId: ORG_ID,
      LaboratoryId: LAB_ID,
      S3Bucket: 'bucket',
      EnableNewBucketsByDefault: false,
    });

    const result = await handler(
      createEvent(LAB_ID, {
        ...baseRequest,
        NextFlowTowerEnabled: false,
        NextFlowTowerApiBaseUrl: undefined,
        NextFlowTowerWorkspaceId: undefined,
        NextFlowTowerAccessToken: undefined,
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(assertLaboratoryHasS3BucketAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        LaboratoryId: LAB_ID,
        EnableNewBucketsByDefault: false,
      }),
      'bucket',
      expect.anything(),
    );
  });
});
