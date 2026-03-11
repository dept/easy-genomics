import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/request-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAccess } from '../../../../../src/app/utils/auth-utils';

describe('request-laboratory.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockValidateOrgAccess: jest.MockedFunction<typeof validateOrganizationAccess>;

  const createEvent = (body: any, overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {}) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/laboratory/request',
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
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'request-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:request-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/request-laboratory',
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
    mockValidateOrgAccess = validateOrganizationAccess as any;
    mockValidateOrgAccess.mockReturnValue(true);
  });

  it('returns laboratory when request is valid and user has access', async () => {
    (mockLabService.prototype.get as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      Name: 'Lab 1',
    });

    const event = createEvent({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
    });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.OrganizationId).toBe('org-1');
    expect(body.LaboratoryId).toBe('lab-1');
    expect(mockValidateOrgAccess).toHaveBeenCalledWith(expect.anything(), 'org-1', 'lab-1');
  });

  it('returns 400 for invalid request body', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.get).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not authorized for organization/laboratory', async () => {
    mockValidateOrgAccess.mockReturnValue(false);

    const result = await handler(
      createEvent({
        OrganizationId: 'org-1',
        LaboratoryId: 'lab-1',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockLabService.prototype.get).not.toHaveBeenCalled();
  });
});
