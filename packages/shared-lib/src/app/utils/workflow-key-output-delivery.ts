export type KeyOutputDeliveryDestination = {
  bucket: string;
  prefix: string;
};

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const LAB_DATA_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

/** True when the prefix is an Easy Genomics `{OrganizationId}/{LaboratoryId}/` lab-data root. */
export function isProtectedLabDataDestination(prefix: string): boolean {
  return LAB_DATA_PREFIX.test(prefix);
}

/** A HealthOmics run that finished successfully and names its workflow. */
export function isCompletedHealthOmicsWorkflowRun(run: {
  Platform?: string;
  Status?: string;
  WorkflowExternalId?: string | null;
}): boolean {
  return (
    run.Platform === 'AWS HealthOmics' &&
    (run.Status === 'COMPLETED' || run.Status === 'SUCCEEDED') &&
    Boolean(run.WorkflowExternalId)
  );
}

/**
 * Parse a lab-manager destination such as `s3://results-bucket/incoming/viralrecon`.
 * Returns null when the URI is not a bucket plus an optional prefix.
 */
export function parseKeyOutputDeliveryUri(uri: string | undefined): KeyOutputDeliveryDestination | null {
  const trimmed = uri?.trim();
  if (!trimmed || !trimmed.toLowerCase().startsWith('s3://')) return null;

  const rest = trimmed.slice('s3://'.length);
  const separator = rest.indexOf('/');
  const bucket = (separator === -1 ? rest : rest.slice(0, separator)).toLowerCase();
  if (!BUCKET_NAME.test(bucket) || bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.')) {
    return null;
  }

  const rawPrefix = separator === -1 ? '' : rest.slice(separator + 1);
  const segments = rawPrefix
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return {
    bucket,
    prefix: segments.length > 0 ? `${segments.join('/')}/` : '',
  };
}
