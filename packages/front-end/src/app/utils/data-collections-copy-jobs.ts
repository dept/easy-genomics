/** Where an imported file lands: its path below the listed folder, under destPrefix, so subfolders never collide. */
export function buildImportDestKey(sourceKey: string, sourcePrefix: string, destPrefix: string): string {
  // A key outside the listed folder keeps its whole key: still unique, where a basename alone would not be.
  const relativeKey = sourceKey.startsWith(sourcePrefix) ? sourceKey.slice(sourcePrefix.length) : sourceKey;
  return `${destPrefix}${relativeKey}`;
}

/** Copy jobs for an S3 import: the source is the key exactly as listed, never rebuilt from the typed prefix. */
export function buildS3CopyJobs(
  files: Array<{ fileName: string }>,
  sourceBucket: string,
  sourcePrefix: string,
  destPrefix: string,
): Array<{ SourceBucket: string; SourceKey: string; DestKey: string }> {
  return files.map((file) => ({
    SourceBucket: sourceBucket,
    SourceKey: file.fileName,
    DestKey: buildImportDestKey(file.fileName, sourcePrefix, destPrefix),
  }));
}
