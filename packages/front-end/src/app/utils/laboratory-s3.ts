import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

const MISSING_S3_BUCKET_MESSAGE = 'no S3 bucket configured';
const BUCKET_DOES_NOT_EXIST_MESSAGE = 'specified bucket does not exist';

export function isLaboratoryS3Configured(lab: Laboratory | null | undefined): boolean {
  return !!lab?.S3Bucket?.trim();
}

export function isMissingLaboratoryS3BucketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_S3_BUCKET_MESSAGE);
}

/** Suppress unlinked-bucket scan errors when the lab has no usable S3 bucket configured. */
export function shouldIgnoreUnlinkedBucketObjectsError(error: unknown, lab: Laboratory | null | undefined): boolean {
  if (isMissingLaboratoryS3BucketError(error)) {
    return true;
  }
  if (!isLaboratoryS3Configured(lab)) {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes(BUCKET_DOES_NOT_EXIST_MESSAGE);
  }
  return false;
}
