/**
 * Default Easy Genomics email branding assets, served over the org-email-assets CloudFront
 * distribution (see OrgEmailAssetsBucketConstruct) rather than a base64 data URI, the bucket's S3
 * REST endpoint, or a `https://${domainName}/images/email/*.png` link.
 *
 * Data URIs are stripped by most email clients (Gmail included) as an anti-phishing measure. The
 * S3 REST endpoint no longer works because the bucket is private. The app-domain-linked form is
 * served by the website's distribution, which geo-restricts to AR/AU/US — Gmail fetches images
 * through Google's image proxy, whose egress country we do not control — and maps 404 to
 * /index.html with HTTP 200, so a missing asset returns SPA HTML instead of an error.
 *
 * ORG_EMAIL_ASSETS_CDN_DOMAIN is set on the common Lambda environment in
 * easy-genomics-nested-stack.ts. Object keys must match OrgEmailAssetsBucketConstruct exactly;
 * default-email-branding.test.ts asserts they do.
 */
function emailAssetUrl(key: string): string {
  return `https://${process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN}/${key}`;
}

export const DEFAULT_EASY_GENOMICS_LOGO_URL = emailAssetUrl('defaults/easy-genomics.png');

export const DEFAULT_LOCK_IMAGE_URL = emailAssetUrl('defaults/lock.png');
