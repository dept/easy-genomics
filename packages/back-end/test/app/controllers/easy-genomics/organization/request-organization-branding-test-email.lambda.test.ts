jest.mock('../../../../../src/app/services/ses-service');
jest.mock('../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(),
  validateSystemAdminAccess: jest.fn(),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/organization/request-organization-branding-test-email.lambda';
import { SesService } from '../../../../../src/app/services/ses-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../src/app/utils/auth-utils';

const sesServiceInstance = (SesService as jest.MockedClass<typeof SesService>).mock
  .instances[0] as jest.Mocked<SesService>;

// OrganizationId travels in the request body rather than as a path parameter: the 'request-'
// Lambda filename verb never registers a path-level {id} resource (see ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID
// in verb-operations.ts, which only covers read-/update-/cancel-/patch-/delete-), so this
// mirrors the OrganizationId-in-body pattern used by create-organization-logo-upload-request.lambda.ts.
function buildEvent(body: Record<string, unknown>, organizationId = 'org-1', email = 'admin@example.com') {
  return {
    body: JSON.stringify({ OrganizationId: organizationId, ...body }),
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { email } } },
  } as any;
}

describe('request-organization-branding-test-email.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    sesServiceInstance.sendRunCompletionEmail = jest.fn().mockResolvedValue({ MessageId: 'test-msg' });
  });

  it('returns 403 when the caller is not an org admin', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(buildEvent({}), {} as any, () => {});

    expect(result.statusCode).toBe(403);
    expect(sesServiceInstance.sendRunCompletionEmail).not.toHaveBeenCalled();
  });

  it('sends the test email to the requesting admin using the unsaved branding values', async () => {
    const result = await handler(
      buildEvent({ EmailBrandingLogoUrl: 'https://acme-labs.example/logo.png' }, 'org-1', 'admin@example.com'),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(sesServiceInstance.sendRunCompletionEmail).toHaveBeenCalledWith(
      'admin@example.com',
      expect.objectContaining({
        logoUrl: 'https://acme-labs.example/logo.png',
        runName: expect.any(String),
      }),
    );
    expect(validateOrganizationAdminAccess).toHaveBeenCalledWith(expect.anything(), 'org-1');
  });

  it('rejects a non-URL EmailBrandingLogoUrl with 400', async () => {
    const result = await handler(buildEvent({ EmailBrandingLogoUrl: 'not-a-url' }), {} as any, () => {});

    expect(result.statusCode).toBe(400);
    expect(sesServiceInstance.sendRunCompletionEmail).not.toHaveBeenCalled();
  });

  it('returns a clear 400 (not an unclassified 500) when SES rejects the send, e.g. sandbox mode', async () => {
    sesServiceInstance.sendRunCompletionEmail = jest.fn().mockRejectedValue(new Error('Email address not verified'));

    const result = await handler(buildEvent({}), {} as any, () => {});

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      Error:
        "Invalid request: Could not send test email — check that this environment's SES configuration allows sending to this address",
      ErrorCode: 'EG-102',
    });
  });
});
