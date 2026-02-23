import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { PreTokenGenerationTriggerEvent } from 'aws-lambda/trigger/cognito-user-pool-trigger/pre-token-generation';
import { handler } from '../../../../src/app/controllers/auth/process-pre-token-generation.lambda';

jest.mock('../../../../src/app/services/easy-genomics/user-service');

import { UserService } from '../../../../src/app/services/easy-genomics/user-service';

const SYSTEM_ADMIN_EMAIL = 'sysadmin@example.com';

const createMockEvent = (email: string): PreTokenGenerationTriggerEvent => ({
  version: '1',
  triggerSource: 'TokenGeneration_Authentication',
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool',
  userName: 'test-user-id',
  callerContext: {
    awsSdkVersion: '1.0.0',
    clientId: 'test-client-id',
  },
  request: {
    userAttributes: {
      sub: 'test-user-id',
      email,
    },
    groupConfiguration: {
      groupsToOverride: [],
      iamRolesToOverride: [],
      preferredRole: '',
    },
  },
  response: {},
});

const baseUser: User = {
  UserId: 'test-user-id',
  Email: 'user@example.com',
  Status: 'Active',
};

describe('process-pre-token-generation Lambda', () => {
  let mockQueryByEmail: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SYSTEM_ADMIN_EMAIL = SYSTEM_ADMIN_EMAIL;

    const MockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockQueryByEmail = jest.fn();
    MockUserService.prototype.queryByEmail = mockQueryByEmail;
  });

  describe('System Admin bypass', () => {
    it('should return the event unchanged when the email matches SYSTEM_ADMIN_EMAIL', async () => {
      const event = createMockEvent(SYSTEM_ADMIN_EMAIL);
      const result = await handler(event, {} as any, () => {});

      expect(result).toEqual(event);
      expect(mockQueryByEmail).not.toHaveBeenCalled();
    });

    it('should not bypass for a non-admin email even if it partially matches', async () => {
      mockQueryByEmail.mockResolvedValue([baseUser]);
      const event = createMockEvent('notsysadmin@example.com');

      await handler(event, {} as any, () => {});

      expect(mockQueryByEmail).toHaveBeenCalledWith('notsysadmin@example.com');
    });
  });

  describe('User not found in DB', () => {
    it('should return the event unchanged when no user is found', async () => {
      mockQueryByEmail.mockResolvedValue([]);
      const event = createMockEvent('unknown@example.com');

      const result = await handler(event, {} as any, () => {});

      expect(result.response).toEqual({});
    });
  });

  describe('Claims for a regular user', () => {
    it('should set all required claims from the user record', async () => {
      const user: User = {
        ...baseUser,
        PreferredName: 'Jo',
        FirstName: 'John',
        LastName: 'Doe',
        DefaultOrganization: 'org-123',
        DefaultLaboratory: 'lab-456',
        OrganizationAccess: {
          'org-123': { Status: 'Active', OrganizationAdmin: true },
        },
        SampleIdSplitPattern: '_S',
      };
      mockQueryByEmail.mockResolvedValue([user]);

      const event = createMockEvent(user.Email);
      const result = await handler(event, {} as any, () => {});

      const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride;
      expect(claims).toBeDefined();
      expect(claims!['PreferredName']).toBe('Jo');
      expect(claims!['FirstName']).toBe('John');
      expect(claims!['LastName']).toBe('Doe');
      expect(claims!['Status']).toBe('Active');
      expect(claims!['DefaultOrganization']).toBe('org-123');
      expect(claims!['DefaultLaboratory']).toBe('lab-456');
      expect(claims!['OrganizationAccess']).toBe(JSON.stringify(user.OrganizationAccess));
      expect(claims!['SampleIdSplitPattern']).toBe('_S');
    });

    it('should use empty strings for optional fields that are absent', async () => {
      mockQueryByEmail.mockResolvedValue([{ ...baseUser }]);
      const event = createMockEvent(baseUser.Email);

      const result = await handler(event, {} as any, () => {});

      const claims = result.response.claimsOverrideDetails?.claimsToAddOrOverride;
      expect(claims!['PreferredName']).toBe('');
      expect(claims!['FirstName']).toBe('');
      expect(claims!['LastName']).toBe('');
      expect(claims!['DefaultOrganization']).toBe('');
      expect(claims!['DefaultLaboratory']).toBe('');
      expect(claims!['SampleIdSplitPattern']).toBe('');
    });

    it('should always set Status from the user record', async () => {
      const inactiveUser: User = { ...baseUser, Status: 'Inactive' };
      mockQueryByEmail.mockResolvedValue([inactiveUser]);

      const result = await handler(createMockEvent(inactiveUser.Email), {} as any, () => {});

      expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['Status']).toBe('Inactive');
    });
  });

  describe('SampleIdSplitPattern claim', () => {
    it('should include SampleIdSplitPattern when set on the user', async () => {
      mockQueryByEmail.mockResolvedValue([{ ...baseUser, SampleIdSplitPattern: '_L001' }]);

      const result = await handler(createMockEvent(baseUser.Email), {} as any, () => {});

      expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['SampleIdSplitPattern']).toBe('_L001');
    });

    it('should emit an empty string when SampleIdSplitPattern is not set', async () => {
      mockQueryByEmail.mockResolvedValue([{ ...baseUser }]);

      const result = await handler(createMockEvent(baseUser.Email), {} as any, () => {});

      expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['SampleIdSplitPattern']).toBe('');
    });
  });

  describe('OrganizationAccess claim', () => {
    it('should JSON-stringify OrganizationAccess when present', async () => {
      const orgAccess = {
        'org-abc': {
          Status: 'Active' as const,
          LaboratoryAccess: { 'lab-xyz': { Status: 'Active' as const } },
        },
      };
      mockQueryByEmail.mockResolvedValue([{ ...baseUser, OrganizationAccess: orgAccess }]);

      const result = await handler(createMockEvent(baseUser.Email), {} as any, () => {});

      expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['OrganizationAccess']).toBe(
        JSON.stringify(orgAccess),
      );
    });

    it('should emit "undefined" string when OrganizationAccess is not set', async () => {
      mockQueryByEmail.mockResolvedValue([{ ...baseUser }]);

      const result = await handler(createMockEvent(baseUser.Email), {} as any, () => {});

      // JSON.stringify(undefined) === undefined; the claim value is the string "undefined"
      expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride?.['OrganizationAccess']).toBe(
        JSON.stringify(undefined),
      );
    });
  });
});
