/**
 * Best-effort extraction of S3 object keys from an arbitrary sample sheet CSV. Picks up any
 * `s3://<bucket>/<key>` reference that points at the supplied bucket; bucket-mismatched and
 * non-S3 cells are ignored. The match is intentionally permissive (does not assume specific
 * column names) since EG-generated and user-supplied CSV formats vary.
 *
 * Shared between the front-end run-upload flow and back-end maintenance scripts so the same
 * rule decides which S3 references count as workflow inputs.
 */
export function extractS3KeysFromCsv(csv: string, bucket: string): string[] {
  if (!csv || !bucket) return [];
  const pattern = /s3:\/\/([^/\s",]+)\/([^\s",]+)/gi;
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(csv)) !== null) {
    const refBucket = match[1];
    const refKey = match[2];
    if (refBucket === bucket && refKey) {
      keys.add(refKey);
    }
  }
  return [...keys];
}
