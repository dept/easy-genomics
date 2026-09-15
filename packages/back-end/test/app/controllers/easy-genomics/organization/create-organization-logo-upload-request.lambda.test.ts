jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(),
  validateSystemAdminAccess: jest.fn(),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/organization/create-organization-logo-upload-request.lambda';
import { S3Service } from '../../../../../src/app/services/s3-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../src/app/utils/auth-utils';

const s3ServiceInstance = (S3Service as jest.MockedClass<typeof S3Service>).mock.instances[0] as jest.Mocked<S3Service>;

// OrganizationId travels in the request body rather than as a path parameter: the 'create-'
// Lambda filename verb never registers a path-level {id} resource (see ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID
// in verb-operations.ts, which only covers read-/update-/cancel-/patch-/delete-), so this
// mirrors the LaboratoryId-in-body pattern used by create-file-upload-request.lambda.ts.
function buildEvent(body: Record<string, unknown>, organizationId = 'org-1') {
  return {
    body: JSON.stringify({ OrganizationId: organizationId, ...body }),
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: {} } },
  } as any;
}

describe('create-organization-logo-upload-request.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ORG_EMAIL_ASSETS_BUCKET_NAME = 'dev-demo-org-email-assets-bucket';
    process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = 'd111111abcdef8.cloudfront.net';
    process.env.REGION = 'us-west-2';
    // The object key is versioned with Date.now() so a re-uploaded logo gets a new CloudFront URL
    // and can never render from cache. Frozen here so the expected key is exact.
    jest.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    s3ServiceInstance.getPreSignedUploadUrl = jest.fn().mockResolvedValue('https://signed-url.example');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 403 when the caller is not an org admin', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(buildEvent({ ContentType: 'image/png', ContentLength: 1000 }), {} as any, () => {});

    expect(result.statusCode).toBe(403);
    expect(s3ServiceInstance.getPreSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for a disallowed content type', async () => {
    const result = await handler(buildEvent({ ContentType: 'image/gif', ContentLength: 1000 }), {} as any, () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for a file over 2MB', async () => {
    const result = await handler(
      buildEvent({ ContentType: 'image/png', ContentLength: 3 * 1024 * 1024 }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });

  it('returns a presigned URL and a versioned CloudFront public URL on the happy path', async () => {
    const result = await handler(
      buildEvent({ ContentType: 'image/png', ContentLength: 1000 }, 'org-1'),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.Key).toBe('org-1/logo-1760000000000.png');
    expect(body.Bucket).toBe('dev-demo-org-email-assets-bucket');
    // The presigned PUT stays on the S3 endpoint — the browser uploads direct to S3.
    expect(body.S3Url).toBe('https://signed-url.example');
    expect(body.PublicUrl).toBe('https://d111111abcdef8.cloudfront.net/org-1/logo-1760000000000.png');
    expect(s3ServiceInstance.getPreSignedUploadUrl).toHaveBeenCalledWith({
      Bucket: 'dev-demo-org-email-assets-bucket',
      Key: 'org-1/logo-1760000000000.png',
      ContentType: 'image/png',
      ContentLength: 1000,
    });
    expect(validateOrganizationAdminAccess).toHaveBeenCalledWith(expect.anything(), 'org-1');
  });

  it('gives a re-upload a different key so the previous logo cannot render from cache', async () => {
    const first = await handler(buildEvent({ ContentType: 'image/png', ContentLength: 1000 }), {} as any, () => {});

    jest.spyOn(Date, 'now').mockReturnValue(1_760_000_009_999);
    const second = await handler(buildEvent({ ContentType: 'image/png', ContentLength: 1000 }), {} as any, () => {});

    expect(JSON.parse(first.body).PublicUrl).not.toBe(JSON.parse(second.body).PublicUrl);
  });

  it('does not return an S3 REST endpoint as the public URL', async () => {
    // The bucket is private; an s3.<region>.amazonaws.com URL renders as a broken image in email.
    const result = await handler(buildEvent({ ContentType: 'image/png', ContentLength: 1000 }), {} as any, () => {});

    expect(JSON.parse(result.body).PublicUrl).not.toContain('amazonaws.com');
  });
});
