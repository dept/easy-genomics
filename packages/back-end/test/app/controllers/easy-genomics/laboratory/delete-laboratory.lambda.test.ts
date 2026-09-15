import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/delete-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-user-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/ssm-service');
jest.mock('../../../../../src/app/services/sqs-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '../../../../../src/app/services/easy-genomics/laboratory-user-service';
import { SqsService } from '../../../../../src/app/services/sqs-service';
import { SsmService } from '../../../../../src/app/services/ssm-service';
import { validateOrganizationAdminAccess } from '../../../../../src/app/utils/auth-utils';

describe('delete-laboratory.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockLabUserService: jest.MockedClass<typeof LaboratoryUserService>;
  let mockLabRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockSqsService: jest.MockedClass<typeof SqsService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;

  const createEvent = (id: string | undefined, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'DELETE',
      path: `/laboratory/${id ?? ''}`,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'admin@example.com',
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
      functionName: 'delete-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:delete-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/delete-laboratory',
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
    mockLabUserService = LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>;
    mockLabRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockSsmService = SsmService as jest.MockedClass<typeof SsmService>;
    mockSqsService = SqsService as jest.MockedClass<typeof SqsService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;

    mockValidateOrgAdmin.mockReturnValue(true);
    process.env.SQS_LABORATORY_DELETION_QUEUE_URL = 'arn:aws:sns:region:acct:lab-deletion';

    mockLabService.prototype.queryByLaboratoryId = jest.fn();
    mockLabService.prototype.delete = jest.fn();
    mockLabUserService.prototype.queryByLaboratoryId = jest.fn();
    mockLabRunService.prototype.queryByLaboratoryId = jest.fn();
    mockSqsService.prototype.sendMessage = jest.fn();
    mockSsmService.prototype.deleteParameter = jest.fn();
  });

  it('returns 400 when id path parameter is missing', async () => {
    const result = await handler(createEvent(undefined), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 403 when caller is not organization admin', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await handler(createEvent('lab-1'), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('publishes delete events, deletes lab and SSM token, and returns success', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    (mockLabUserService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: 'lab-1', UserId: 'user-1' },
    ]);
    (mockLabRunService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue([
      { LaboratoryId: 'lab-1', RunId: 'run-1' },
    ]);
    (mockSqsService.prototype.sendMessage as jest.Mock).mockResolvedValue({});
    (mockLabService.prototype.delete as jest.Mock).mockResolvedValue(true);
    (mockSsmService.prototype.deleteParameter as jest.Mock).mockResolvedValue({});

    const result = await handler(createEvent('lab-1'), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Status).toBe('Success');
    expect(mockSqsService.prototype.sendMessage).toHaveBeenCalled();
    expect(mockLabService.prototype.delete).toHaveBeenCalled();
    expect(mockSsmService.prototype.deleteParameter).toHaveBeenCalled();
  });
});
