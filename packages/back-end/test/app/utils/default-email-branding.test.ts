// Set before the import below: default-email-branding.ts builds its constants at module load, so a
// beforeEach would run too late.
process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN = 'd111111abcdef8.cloudfront.net';

import { DEFAULT_EASY_GENOMICS_LOGO_URL, DEFAULT_LOCK_IMAGE_URL } from '../../../src/app/utils/default-email-branding';
import {
  DEFAULT_EASY_GENOMICS_LOGO_KEY,
  DEFAULT_LOCK_IMAGE_KEY,
} from '../../../src/infra/constructs/org-email-assets-bucket-construct';

describe('default-email-branding', () => {
  it('builds the default logo URL from the CloudFront domain and the construct-defined key', () => {
    expect(DEFAULT_EASY_GENOMICS_LOGO_URL).toBe(
      `https://d111111abcdef8.cloudfront.net/${DEFAULT_EASY_GENOMICS_LOGO_KEY}`,
    );
  });

  it('builds the default lock image URL from the CloudFront domain and the construct-defined key', () => {
    expect(DEFAULT_LOCK_IMAGE_URL).toBe(`https://d111111abcdef8.cloudfront.net/${DEFAULT_LOCK_IMAGE_KEY}`);
  });

  it('does not point at the S3 REST endpoint', () => {
    // The bucket is private; an s3.<region>.amazonaws.com URL renders as a broken image in email.
    expect(DEFAULT_EASY_GENOMICS_LOGO_URL).not.toContain('amazonaws.com');
    expect(DEFAULT_LOCK_IMAGE_URL).not.toContain('amazonaws.com');
  });

  it('stays in sync with the S3 keys the org-email-assets bucket construct seeds', () => {
    // Guards against the two files drifting apart: default-email-branding.ts hardcodes these
    // keys rather than importing them (to avoid a src -> infra dependency), so this test fails
    // loudly instead of the image URLs silently breaking if one file changes without the other.
    expect(DEFAULT_EASY_GENOMICS_LOGO_URL.endsWith(`/${DEFAULT_EASY_GENOMICS_LOGO_KEY}`)).toBe(true);
    expect(DEFAULT_LOCK_IMAGE_URL.endsWith(`/${DEFAULT_LOCK_IMAGE_KEY}`)).toBe(true);
  });
});
