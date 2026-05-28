import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

export const S3_URI_FIELDS = ['InputS3Url', 'OutputS3Url', 'SampleSheetS3Url'] as const;

export function rewriteS3UriHost(uri: string | undefined, oldBucket: string, newBucket: string): string | undefined {
  if (uri == null || uri === '') return uri;
  if (!uri.startsWith('s3://')) return uri;
  const withoutScheme = uri.slice('s3://'.length);
  const slash = withoutScheme.indexOf('/');
  const host = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  const suffix = slash === -1 ? '' : withoutScheme.slice(slash);
  if (host !== oldBucket) return uri;
  return `s3://${newBucket}${suffix}`;
}

export function rewriteLaboratoryRun(run: LaboratoryRun, oldBucket: string, newBucket: string): LaboratoryRun | null {
  let changed = false;
  const next: LaboratoryRun = { ...run };

  for (const field of S3_URI_FIELDS) {
    const current = run[field];
    const rewritten = rewriteS3UriHost(current, oldBucket, newBucket);
    if (rewritten !== current) {
      if (rewritten === undefined) {
        delete next[field];
      } else {
        next[field] = rewritten;
      }
      changed = true;
    }
  }

  return changed ? next : null;
}
