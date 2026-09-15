const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendTemplatedEmailCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
import { SesService } from '../../../src/app/services/ses-service';
import { DEFAULT_EASY_GENOMICS_LOGO_URL, DEFAULT_LOCK_IMAGE_URL } from '../../../src/app/utils/default-email-branding';

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

  it('does not call SES for existing-user courtesy email in non-prod (SES sandbox)', async () => {
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    const result = await service.sendExistingUserCourtesyEmail('anyone@example.com', 'My Org');

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.MessageId).toBe('skipped-non-prod-courtesy-email');
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
    expect(templateData.EASY_GENOMICS_EMAIL_LOGO).toBe(DEFAULT_EASY_GENOMICS_LOGO_URL);
    expect(templateData.LOCK_IMAGE).toBe(DEFAULT_LOCK_IMAGE_URL);
  });

  it('uses org branding for invitation email when provided', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'msg-5' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    await service.sendNewUserInvitationEmail('test@example.com', 'My Org', 'jwt-token', {
      logoUrl: 'https://acme-labs.example/logo.png',
    });

    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    const templateData = JSON.parse(cmdInput.TemplateData);
    expect(templateData.EASY_GENOMICS_EMAIL_LOGO).toBe('https://acme-labs.example/logo.png');
  });

  it('falls back to default branding for invitation email when branding is omitted', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'msg-6' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'dev',
      envName: 'sandbox',
    });

    await service.sendNewUserInvitationEmail('test@example.com', 'My Org', 'jwt-token');

    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    const templateData = JSON.parse(cmdInput.TemplateData);
    expect(templateData.EASY_GENOMICS_EMAIL_LOGO).toBe(DEFAULT_EASY_GENOMICS_LOGO_URL);
  });

  it('rewrites a legacy stored S3 logo URL onto the CDN domain for invitation email', async () => {
    const originalCdnDomain = process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN;
    const originalNamePrefix = process.env.NAME_PREFIX;
    process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = 'd111111abcdef8.cloudfront.net';
    // The matcher in email-branding-logo-url.ts binds the legacy host to this deployment's
    // NAME_PREFIX, so the stored URL's bucket host below must be built from the same prefix or
    // the rewrite legitimately declines and this case stops proving the wiring.
    process.env.NAME_PREFIX = 'dev';
    try {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-legacy' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendNewUserInvitationEmail('test@example.com', 'My Org', 'jwt-token', {
        logoUrl: 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png',
      });

      const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(cmdInput.TemplateData);
      expect(templateData.EASY_GENOMICS_EMAIL_LOGO).toBe('https://d111111abcdef8.cloudfront.net/org-123/logo.png');
    } finally {
      if (originalCdnDomain === undefined) {
        delete process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN;
      } else {
        process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = originalCdnDomain;
      }
      if (originalNamePrefix === undefined) {
        delete process.env.NAME_PREFIX;
      } else {
        process.env.NAME_PREFIX = originalNamePrefix;
      }
    }
  });

  it('uses org branding for courtesy email when provided (prod, so SES is actually called)', async () => {
    mockSend.mockResolvedValueOnce({ MessageId: 'msg-7' });
    const service = new SesService({
      accountId: '123456789012',
      region: 'us-west-2',
      domainName: 'example.com',
      envType: 'prod',
      envName: 'production',
    });

    await service.sendExistingUserCourtesyEmail('test@example.com', 'My Org', {
      logoUrl: 'https://acme-labs.example/logo.png',
    });

    const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    const templateData = JSON.parse(cmdInput.TemplateData);
    expect(templateData.EASY_GENOMICS_EMAIL_LOGO).toBe('https://acme-labs.example/logo.png');
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

  describe('SesService.sendRunCompletionEmail', () => {
    it('sends the RunCompletionEmailTemplate with a deep link built from LaboratoryId/RunId', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-1' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'COMPLETED',
        laboratoryName: 'Test Lab',
        workflowName: 'Variant Calling',
        runDurationSeconds: 3600,
        runId: 'run-1',
        laboratoryId: 'lab-1',
      });

      expect(SendTemplatedEmailCommand).toHaveBeenCalledTimes(1);
      const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(cmdInput.Template).toBe('sandbox-dev-RunCompletionEmailTemplate');
      expect(cmdInput.Destination?.ToAddresses).toEqual(['tech@example.com']);
      const templateData = JSON.parse(cmdInput.TemplateData);
      expect(templateData.RUN_LINK).toBe('https://example.com/labs/lab-1/run/run-1');
      expect(templateData.STATUS_PHRASE).toBe('completed successfully');
    });

    it('formats STATUS_PHRASE for a non-COMPLETED status (FAILED)', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-failed' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'FAILED',
        laboratoryName: 'Test Lab',
        runId: 'run-1',
        laboratoryId: 'lab-1',
      });

      const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(cmdInput.TemplateData);
      expect(templateData.STATUS_PHRASE).toBe('failed');
    });

    it('falls back to the generic STATUS_PHRASE for an unrecognized status', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-running' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'RUNNING',
        laboratoryName: 'Test Lab',
        runId: 'run-1',
        laboratoryId: 'lab-1',
      });

      const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(cmdInput.TemplateData);
      expect(templateData.STATUS_PHRASE).toBe('is RUNNING');
    });

    it('formats RUN_TIME as a labeled duration string instead of raw seconds', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-2' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'COMPLETED',
        laboratoryName: 'Test Lab',
        runDurationSeconds: 911,
        runId: 'run-1',
        laboratoryId: 'lab-1',
      });

      const cmdInput = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(cmdInput.TemplateData);
      expect(templateData.RUN_TIME).toBe('0d 0h 15m 11s');
      expect(templateData.RUN_DURATION_SECONDS).toBeUndefined();
    });

    it('uses the org logo when provided, falling back to the default otherwise', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-3' }).mockResolvedValueOnce({ MessageId: 'msg-4' });
      const service = new SesService({
        accountId: '123456789012',
        region: 'us-west-2',
        domainName: 'example.com',
        envType: 'dev',
        envName: 'sandbox',
      });

      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'COMPLETED',
        laboratoryName: 'Test Lab',
        runId: 'run-1',
        laboratoryId: 'lab-1',
        logoUrl: 'https://acme-labs.example/logo.png',
      });
      await service.sendRunCompletionEmail('tech@example.com', {
        runName: 'My Run',
        status: 'COMPLETED',
        laboratoryName: 'Test Lab',
        runId: 'run-1',
        laboratoryId: 'lab-1',
      });

      const calls = (SendTemplatedEmailCommand as unknown as jest.Mock).mock.calls;
      const brandedData = JSON.parse(calls[0][0].TemplateData);
      const defaultData = JSON.parse(calls[1][0].TemplateData);

      expect(brandedData.EASY_GENOMICS_EMAIL_LOGO).toBe('https://acme-labs.example/logo.png');
      expect(defaultData.EASY_GENOMICS_EMAIL_LOGO).toBe(DEFAULT_EASY_GENOMICS_LOGO_URL);
    });
  });
});
