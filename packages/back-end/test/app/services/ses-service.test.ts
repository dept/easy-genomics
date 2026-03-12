const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendTemplatedEmailCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
import { SesService } from '../../../src/app/services/ses-service';

describe('SesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses envName-envType template prefix for non-prod when both values are present', () => {
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    expect(service.templateNamePrefix).toBe('sandbox-dev-');
  });

  it('does not use undefined template prefix when envName/envType are missing', () => {
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: undefined as unknown as string,
      envName: undefined as unknown as string,
    });

    expect(service.templateNamePrefix).toBe('');
  });

  it('does not use prefix in prod', () => {
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'prod',
      envName: 'production',
    });

    expect(service.templateNamePrefix).toBe('');
  });

  it('builds invitation SES command with prefixed template in non-prod', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'abc' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    await service.sendNewUserInvitationEmail('test@example.com', 'My Org', 'jwt-token');

    expect(SendTemplatedEmailCommand).toHaveBeenCalledTimes(1);
    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmdInput.Template).toBe('sandbox-dev-NewUserInvitationEmailTemplate');
    expect(cmdInput.SourceArn).toBe('arn:aws:ses:us-west-2:123456789012:identity/example.com');
    const templateData = JSON.parse(cmdInput.TemplateData);
    expect(templateData.ORGANIZATION_NAME).toBe('My Org');
    expect(templateData.INVITATION_JWT).toBe('jwt-token');
  });

  it('builds courtesy SES command without prefix in prod', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'def' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'prod',
      envName: 'production',
    });

    await service.sendExistingUserCourtesyEmail('test@example.com', 'My Org');

    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmdInput.Template).toBe('ExistingUserCourtesyEmailTemplate');
  });

  it('builds forgot-password SES command with jwt in payload', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'ghi' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    await service.sendUserForgotPasswordEmail('test@example.com', 'forgot-jwt');

    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmdInput.Template).toBe('sandbox-dev-UserForgotPasswordEmailTemplate');
    const templateData = JSON.parse(cmdInput.TemplateData);
    expect(templateData.FORGOT_PASSWORD_JWT).toBe('forgot-jwt');
  });

  it('wraps SES errors with request-specific context', async () => {
    mockSend.mockRejectedValueOnce(new Error('Email address is not verified'));
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    await expect(service.sendNewUserInvitationEmail('test@example.com', 'My Org', 'jwt-token')).rejects.toThrow(
      'Send New User Invitation Email request: test@example.com unsuccessful: Email address is not verified',
    );
  });
});
