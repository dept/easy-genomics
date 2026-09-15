import { resolveEmailBrandingLogoUrl } from '../../../src/app/utils/email-branding-logo-url';

describe('resolveEmailBrandingLogoUrl', () => {
  const originalCdnDomain = process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN;
  const originalNamePrefix = process.env.NAME_PREFIX;

  beforeEach(() => {
    process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = 'd111111abcdef8.cloudfront.net';
    process.env.NAME_PREFIX = 'dev';
  });

  afterEach(() => {
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
  });

  it('rewrites a legacy .png S3 REST URL onto the CDN domain, preserving the path', () => {
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe('https://d111111abcdef8.cloudfront.net/org-123/logo.png');
  });

  it('rewrites a legacy .jpg S3 REST URL onto the CDN domain, preserving the path', () => {
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.jpg';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe('https://d111111abcdef8.cloudfront.net/org-123/logo.jpg');
  });

  it('recognises a legacy URL from a different region', () => {
    process.env.NAME_PREFIX = 'prod';
    const storedUrl = 'https://prod-org-email-assets-bucket.s3.eu-central-1.amazonaws.com/org-456/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe('https://d111111abcdef8.cloudfront.net/org-456/logo.png');
  });

  it('produces a rewritten result that contains no amazonaws.com', () => {
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).not.toContain('amazonaws.com');
  });

  it('returns an already-CloudFront URL unchanged (idempotent)', () => {
    const cdnUrl = 'https://d111111abcdef8.cloudfront.net/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(cdnUrl)).toBe(cdnUrl);
  });

  it('passes through an unrelated external URL untouched', () => {
    const externalUrl = 'https://cdn.example.org/brand/logo.png';

    expect(resolveEmailBrandingLogoUrl(externalUrl)).toBe(externalUrl);
  });

  it('passes through a URL for a different S3 bucket untouched', () => {
    const otherBucketUrl = 'https://some-other-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(otherBucketUrl)).toBe(otherBucketUrl);
  });

  it("passes through another account's coincidentally-suffixed bucket untouched", () => {
    // Regression guard: S3 bucket names are globally unique, not secret, and this suffix is
    // generic-sounding. A host must carry *this* deployment's NAME_PREFIX, not merely end in
    // "org-email-assets-bucket", or an unrelated bucket belonging to someone else gets rewritten
    // to our CloudFront domain, producing a wrong image or a 404.
    const otherAccountUrl = 'https://evil-org-email-assets-bucket.s3.us-east-1.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(otherAccountUrl)).toBe(otherAccountUrl);
  });

  it('passes through a bare org-email-assets-bucket host with no prefix untouched', () => {
    const noPrefixUrl = 'https://org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(noPrefixUrl)).toBe(noPrefixUrl);
  });

  it('returns undefined for an undefined stored URL', () => {
    expect(resolveEmailBrandingLogoUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(resolveEmailBrandingLogoUrl('')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only string', () => {
    expect(resolveEmailBrandingLogoUrl('   ')).toBeUndefined();
  });

  it('does not throw and returns a malformed non-URL string unchanged', () => {
    const malformed = 'not a url';

    expect(() => resolveEmailBrandingLogoUrl(malformed)).not.toThrow();
    expect(resolveEmailBrandingLogoUrl(malformed)).toBe(malformed);
  });

  it('returns a legacy URL unchanged when ORG_EMAIL_ASSETS_CDN_DOMAIN is unset', () => {
    delete process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN;
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe(storedUrl);
  });

  it('returns a legacy URL unchanged when ORG_EMAIL_ASSETS_CDN_DOMAIN is an empty string', () => {
    process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = '';
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe(storedUrl);
  });

  it('returns a legacy URL unchanged when NAME_PREFIX is unset', () => {
    delete process.env.NAME_PREFIX;
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe(storedUrl);
  });

  it('returns a legacy URL unchanged when NAME_PREFIX is an empty string', () => {
    process.env.NAME_PREFIX = '';
    const storedUrl = 'https://dev-org-email-assets-bucket.s3.us-west-2.amazonaws.com/org-123/logo.png';

    expect(resolveEmailBrandingLogoUrl(storedUrl)).toBe(storedUrl);
  });
});
