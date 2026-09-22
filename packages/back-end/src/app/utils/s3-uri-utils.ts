export type ParsedS3Uri = { bucket: string; prefix: string };

/**
 * Parses an `s3://bucket/key` URI. Returns `null` for anything that is not a well-formed S3 URI
 * rather than throwing, so callers on best-effort paths (stream subscribers, scheduled sweeps)
 * can skip bad data without failing the whole batch.
 *
 * The pathname is percent-decoded because `URL` encodes it on parse; run-derived keys such as
 * generated sample sheet names can contain spaces.
 */
export function parseS3Uri(value: string | undefined): ParsedS3Uri | null {
  if (!value || !value.startsWith('s3://')) return null;
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
    return {
      bucket: url.hostname,
      prefix: decodeURIComponent(url.pathname).replace(/^\/*/, ''),
    };
  } catch {
    return null;
  }
}

export function normalizeS3Prefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

/**
 * True when `key` sits inside the run's own transaction folder. Run outputs and generated sample
 * sheets always live under `{org}/{lab}/{platform}/{runId}/`, because the front-end reuses one
 * UUID as both the upload transaction id and the `RunId`. Requiring the run id as a path segment
 * keeps prefix deletion from ever escaping a single run's folder — a custom `outdir` pointing
 * somewhere else is skipped rather than deleted.
 */
export function isWithinRunFolder(
  key: string,
  laboratory: { OrganizationId: string; LaboratoryId: string },
  runId: string,
): boolean {
  if (!runId) return false;
  const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  if (!key.startsWith(labPrefix)) return false;
  return key.includes(`/${runId}/`);
}
