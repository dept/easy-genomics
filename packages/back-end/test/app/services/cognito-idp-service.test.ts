const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  AdminCreateUserCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoIdpService } from '../../../src/app/services/cognito-idp-service';

describe('CognitoIdpService.adminCreateUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({
      $metadata: { httpStatusCode: 200 },
      User: { Username: 'user@example.com' },
    });
  });

  it('includes branding fields in ClientMetadata when provided', async () => {
    const service = new CognitoIdpService({ userPoolId: 'pool-1' });

    await service.adminCreateUser('user@example.com', 'org-1', 'My Org', false, {
      logoUrl: 'https://acme-labs.example/logo.png',
    });

    const input = (AdminCreateUserCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.ClientMetadata.EmailBrandingLogoUrl).toBe('https://acme-labs.example/logo.png');
  });

  it('omits branding keys from ClientMetadata when not provided', async () => {
    const service = new CognitoIdpService({ userPoolId: 'pool-1' });

    await service.adminCreateUser('user@example.com', 'org-1', 'My Org');

    const input = (AdminCreateUserCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.ClientMetadata.EmailBrandingLogoUrl).toBeUndefined();
  });
});
