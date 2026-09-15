jest.mock('../../../../src/app/services/ses-service');
jest.mock('../../../../src/app/utils/jwt-utils', () => ({
  generateJwt: jest.fn().mockReturnValue('mock-jwt'),
}));

import { handler } from '../../../../src/app/controllers/auth/process-custom-email-sender.lambda';
import { SesService } from '../../../../src/app/services/ses-service';

const sesServiceInstance = (SesService as jest.MockedClass<typeof SesService>).mock
  .instances[0] as jest.Mocked<SesService>;

describe('process-custom-email-sender.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET_KEY = 'unit-test-jwt-secret';
    sesServiceInstance.sendNewUserInvitationEmail = jest.fn().mockResolvedValue({});
    sesServiceInstance.sendUserForgotPasswordEmail = jest.fn().mockResolvedValue({});
  });

  it('passes EmailBrandingLogoUrl from clientMetadata through to sendNewUserInvitationEmail', async () => {
    const event = {
      triggerSource: 'CustomEmailSender_AdminCreateUser',
      request: {
        userAttributes: { email: 'user@example.com', sub: 'user-1' },
        code: 'encrypted-code',
        clientMetadata: {
          OrganizationId: 'org-1',
          OrganizationName: 'Acme Labs',
          EmailBrandingLogoUrl: 'https://acme-labs.example/logo.png',
        },
      },
    } as any;

    await handler(event, {} as any, () => {});

    expect(sesServiceInstance.sendNewUserInvitationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Acme Labs',
      expect.any(String),
      { logoUrl: 'https://acme-labs.example/logo.png' },
    );
  });

  it('passes undefined branding when clientMetadata has no branding keys', async () => {
    const event = {
      triggerSource: 'CustomEmailSender_AdminCreateUser',
      request: {
        userAttributes: { email: 'user@example.com', sub: 'user-1' },
        code: 'encrypted-code',
        clientMetadata: { OrganizationId: 'org-1', OrganizationName: 'Acme Labs' },
      },
    } as any;

    await handler(event, {} as any, () => {});

    expect(sesServiceInstance.sendNewUserInvitationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Acme Labs',
      expect.any(String),
      { logoUrl: undefined },
    );
  });
});
