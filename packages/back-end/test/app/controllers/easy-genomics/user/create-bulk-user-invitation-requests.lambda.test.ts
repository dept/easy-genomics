import { OrganizationNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/user/create-bulk-user-invitation-requests.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/organization-service');
jest.mock('../../../../../src/app/services/sqs-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { OrganizationService } from '../../../../../src/app/services/easy-genomics/organization-service';
import { SqsService } from '../../../../../src/app/services/sqs-service';
import { validateSystemAdminAccess, validateOrganizationAdminAccess } from '../../../../../src/app/utils/auth-utils';

const ORG_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const createMockEvent = (
  body: any,
  overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
): APIGatewayProxyWithCognitoAuthorizerEvent => ({
  body: JSON.stringify(body),
  isBase64Encoded: false,
  httpMethod: 'POST',
  path: '/user/create-bulk-user-invitation-requests',
  headers: {},
  requestContext: {
    authorizer: { claims: { 'cognito:username': 'test-user-id' } },
  } as any,
  resource: '',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  multiValueHeaders: {},
  ...overrides,
});

describe('create-bulk-user-invitation-requests Lambda', () => {
  let mockValidateSysAdmin: jest.MockedFunction<typeof validateSystemAdminAccess>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockOrgGet: jest.Mock;
  let mockSqsSendMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    process.env.SQS_USER_INVITE_QUEUE_URL = 'arn:aws:sns:us-east-1:123456789012:test-topic.fifo';

    mockValidateSysAdmin = validateSystemAdminAccess as jest.MockedFunction<typeof validateSystemAdminAccess>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.MockedFunction<
      typeof validateOrganizationAdminAccess
    >;

    const MockOrgService = OrganizationService as jest.MockedClass<typeof OrganizationService>;
    mockOrgGet = jest.fn();
    MockOrgService.prototype.get = mockOrgGet;

    const MockSqsService = SqsService as jest.MockedClass<typeof SqsService>;
    mockSqsSendMessage = jest.fn();
    MockSqsService.prototype.sendMessage = mockSqsSendMessage;
  });

  it('returns EG-102 when the request body fails Zod validation', async () => {
    const result = (await handler(createMockEvent({}), {} as any, () => {})) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-102' });
  });

  it('returns EG-103 when caller is neither system admin nor org admin', async () => {
    mockValidateSysAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = (await handler(
      createMockEvent({ OrganizationId: ORG_ID, Emails: ['user@example.com'] }),
      {} as any,
      () => {},
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-103' });
  });

  it('returns EG-203 when the organization is not found', async () => {
    mockValidateSysAdmin.mockReturnValue(true);
    mockOrgGet.mockRejectedValue(new OrganizationNotFoundError());

    const result = (await handler(
      createMockEvent({ OrganizationId: ORG_ID, Emails: ['user@example.com'] }),
      {} as any,
      () => {},
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-203' });
  });

  it('publishes one SNS message per email and returns success', async () => {
    mockValidateSysAdmin.mockReturnValue(true);
    mockOrgGet.mockResolvedValue({ OrganizationId: ORG_ID });
    mockSqsSendMessage.mockResolvedValue({});

    const emails = ['a@example.com', 'b@example.com'];
    const result = (await handler(
      createMockEvent({ OrganizationId: ORG_ID, Emails: emails }),
      {} as any,
      () => {},
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ Status: 'success' });
    expect(mockSqsSendMessage).toHaveBeenCalledTimes(emails.length);
  });
});
