import { PostAuthenticationTriggerEvent } from 'aws-lambda';
import { handler } from '../../../../src/app/controllers/auth/process-post-authentication.lambda';

jest.mock('../../../../src/app/services/auth/authentication-log-service');

import { AuthenticationLogService } from '../../../../src/app/services/auth/authentication-log-service';

const createMockEvent = (): PostAuthenticationTriggerEvent => ({
  version: '1',
  triggerSource: 'PostAuthentication_Authentication',
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool',
  userName: 'test-user-id',
  callerContext: {
    awsSdkVersion: '1.0.0',
    clientId: 'test-client-id',
  },
  request: {
    userAttributes: { sub: 'test-user-id', email: 'user@example.com' },
    newDeviceUsed: false,
  },
  response: {},
});

describe('process-post-authentication Lambda', () => {
  let mockAdd: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const MockAuthLogService = AuthenticationLogService as jest.MockedClass<typeof AuthenticationLogService>;
    mockAdd = jest.fn();
    MockAuthLogService.prototype.add = mockAdd;
  });

  it('returns the event unchanged when audit logging succeeds', async () => {
    mockAdd.mockResolvedValue(undefined);
    const event = createMockEvent();

    const result = await handler(event, {} as any, () => {});

    expect(result).toEqual(event);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ UserName: 'test-user-id' }));
  });

  it('swallows audit log errors and still returns the event so auth is not blocked', async () => {
    mockAdd.mockRejectedValue(new Error('DynamoDB down'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const event = createMockEvent();

    const result = await handler(event, {} as any, () => {});

    expect(result).toEqual(event);
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
  });
});
