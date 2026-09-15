// v1.5 persisted an absolute S3 REST URL for an organization's uploaded logo
// (https://{NAME_PREFIX}-org-email-assets-bucket.s3.{REGION}.amazonaws.com/{organizationId}/logo.{png|jpg}).
// The bucket is now private, so that URL 403s and renders as a broken image in every branded
// email. The object itself is still in the bucket at the same key, so rewriting only the host
// onto the CloudFront domain makes the stored URL fetchable again, with no data migration needed.

// process.env.NAME_PREFIX is deployment config, not a trusted pattern fragment: escape it before
// interpolating into a RegExp so a prefix containing regex metacharacters can't change what matches.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The Email branding logo URL field is free text (see EGFormOrgEmailBranding.vue): an admin can
// paste an external CDN or corporate-host URL, including one for someone else's S3 bucket. S3
// bucket names are globally unique and this one is generic-sounding, not secret, so the match must
// be bound to this deployment's own NAME_PREFIX rather than any host that merely ends in
// "org-email-assets-bucket" — otherwise a legitimate third-party URL with that suffix would be
// silently rewritten to our CloudFront domain. The region segment stays permissive because it
// legitimately varies by deployment and isn't the source of the ambiguity.
function buildLegacyOrgEmailAssetsHostPattern(namePrefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(namePrefix)}-org-email-assets-bucket\\.s3([.-][^.]+)?\\.amazonaws\\.com$`, 'i');
}

export function resolveEmailBrandingLogoUrl(storedUrl?: string): string | undefined {
  if (!storedUrl || !storedUrl.trim()) {
    return undefined;
  }

  const cdnDomain = process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN;
  if (!cdnDomain) {
    return storedUrl;
  }

  // Without NAME_PREFIX there is no deployment-scoped pattern to match against. Guessing (e.g.
  // falling back to a permissive match) would reopen the over-match hole this function exists to
  // close, so decline to rewrite rather than risk corrupting a legitimate third-party URL.
  const namePrefix = process.env.NAME_PREFIX;
  if (!namePrefix) {
    return storedUrl;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(storedUrl);
  } catch {
    return storedUrl;
  }

  if (!buildLegacyOrgEmailAssetsHostPattern(namePrefix).test(parsedUrl.host)) {
    return storedUrl;
  }

  parsedUrl.host = cdnDomain;
  return parsedUrl.toString();
}
