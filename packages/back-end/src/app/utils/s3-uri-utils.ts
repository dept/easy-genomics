export type ParsedS3Uri = { bucket: string; prefix: string };

const S3_SCHEME = 's3://';

/** Upload transaction ids (which double as run ids) are UUIDs; anything else is not a run folder. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `buildSampleSheetFileName` output: `samplesheet.csv` or `samplesheet-{run name}.csv`. */
const SAMPLE_SHEET_PATTERN = /^samplesheet[^/]*\.csv$/i;

/**
 * Parses an `s3://bucket[/key]` URI by string split. The key may be empty, for callers that accept
 * a bucket-rooted location.
 *
 * Deliberately not `new URL`: S3 keys are opaque byte strings and the URI is stored unencoded, so
 * URL semantics actively corrupt them. A `#` would start a fragment and silently truncate the key,
 * and percent-decoding throws on a bare `%` — both characters are permitted in generated sample
 * sheet names (see `buildSampleSheetFileName`). Splitting on the first `/` after the scheme
 * returns the key exactly as stored.
 *
 * Returns `null` rather than throwing for anything malformed, so best-effort callers (stream
 * subscribers, scheduled sweeps) can skip bad data without failing a whole batch.
 */
export function parseS3Uri(value: string | undefined): ParsedS3Uri | null {
  if (!value || !value.startsWith(S3_SCHEME)) return null;
  const rest = value.slice(S3_SCHEME.length);
  const separator = rest.indexOf('/');
  const bucket = separator === -1 ? rest : rest.slice(0, separator);
  if (!bucket) return null;
  return { bucket, prefix: separator === -1 ? '' : rest.slice(separator + 1) };
}

/**
 * As `parseS3Uri`, but also requires a non-empty key. Use this wherever the parsed value has to
 * name something concrete — a bucket-rooted `s3://bucket` is never a valid delete target.
 */
export function parseS3ObjectUri(value: string | undefined): ParsedS3Uri | null {
  const parsed = parseS3Uri(value);
  return parsed && parsed.prefix ? parsed : null;
}

export function normalizeS3Prefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

export function laboratoryPrefix(laboratory: { OrganizationId: string; LaboratoryId: string }): string {
  return `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
}

/**
 * True when `key` sits inside the run's own transaction folder. Run outputs and generated sample
 * sheets always live under `{org}/{lab}/{platform}/{runId}/`, because the front-end reuses one
 * UUID as both the upload transaction id and the `RunId`. Requiring the run id as a path segment
 * keeps deletion from ever escaping a single run's folder.
 */
export function isWithinRunFolder(
  key: string,
  laboratory: { OrganizationId: string; LaboratoryId: string },
  runId: string,
): boolean {
  if (!runId) return false;
  if (!key.startsWith(laboratoryPrefix(laboratory))) return false;
  return key.includes(`/${runId}/`);
}

/**
 * True when `prefix` names a directory strictly *below* the run folder root.
 *
 * Prefix deletion is recursive, and a run's input files sit at the run folder root, so recording
 * the root itself (reachable by a user pointing the workflow's `outdir` parameter at it) would let
 * the sweep delete inputs wholesale — bypassing the FILE#-row sharing and Permanent-tag rules that
 * own them. Requiring at least one more path segment confines prefix deletes to subdirectories
 * such as `results/`, which only ever contain workflow output.
 */
export function isBelowRunFolderRoot(
  prefix: string,
  laboratory: { OrganizationId: string; LaboratoryId: string },
  runId: string,
): boolean {
  if (!isWithinRunFolder(prefix, laboratory, runId)) return false;
  const marker = `/${runId}/`;
  const tail = prefix.slice(prefix.indexOf(marker) + marker.length);
  return tail.replace(/\/+$/, '').length > 0;
}

export function lastPathSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function isRunFolderName(name: string): boolean {
  return UUID_PATTERN.test(name);
}

/** True for a generated sample sheet sitting directly at the run folder root (not in a subfolder). */
export function isSampleSheetKey(key: string, runFolderPrefix: string): boolean {
  if (!key.startsWith(runFolderPrefix)) return false;
  const relative = key.slice(runFolderPrefix.length);
  return !relative.includes('/') && SAMPLE_SHEET_PATTERN.test(relative);
}
