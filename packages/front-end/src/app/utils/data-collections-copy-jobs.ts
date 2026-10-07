import { basenameFromS3Key } from '@FE/utils/data-collections-file-type';

/** Copy jobs for an S3 import: the source is the key exactly as listed, never rebuilt from the typed prefix. */
export function buildS3CopyJobs(
  files: Array<{ fileName: string }>,
  sourceBucket: string,
  destPrefix: string,
): Array<{ SourceBucket: string; SourceKey: string; DestKey: string }> {
  return files.map((file) => ({
    SourceBucket: sourceBucket,
    SourceKey: file.fileName,
    DestKey: `${destPrefix}${basenameFromS3Key(file.fileName)}`,
  }));
}
